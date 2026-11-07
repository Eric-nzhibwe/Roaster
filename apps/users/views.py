import logging
import threading
import uuid

import firebase_admin
from django.conf import settings
from django.contrib.auth import logout as django_auth_logout
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from firebase_admin import auth as firebase_auth

from .models import User
from .serializers import UserSerializer, UpdateProfileSerializer
from .firestore_service import (
    sync_user, update_user_profile, delete_user_document,
    log_signup, log_login, log_profile_updated, log_account_deleted,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _get_tokens(user):
    refresh = RefreshToken.for_user(user)
    return {'access': str(refresh.access_token), 'refresh': str(refresh)}


def _set_auth_cookies(response, tokens):
    secure = not settings.DEBUG
    response.set_cookie(
        'access_token', tokens['access'],
        max_age=7 * 24 * 3600,
        httponly=True, secure=secure, samesite='Lax', path='/',
    )
    response.set_cookie(
        'refresh_token', tokens['refresh'],
        max_age=30 * 24 * 3600,
        httponly=True, secure=secure, samesite='Lax', path='/',
    )
    return response


def _firestore_sync(user, uid, created, email, provider_key):
    """Run Firestore writes in a background thread — never blocks the response."""
    try:
        sync_user(user, uid, is_new=created)
        if created:
            log_signup(uid, email, provider_key)
        else:
            log_login(uid)
    except Exception:
        logger.exception('Firestore sync failed for uid=%s', uid)


# ─────────────────────────────────────────────
# Views
# ─────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
def firebase_session(request):
    """
    Exchange a Firebase ID token for Django JWT cookies.
    Handles both sign-up and sign-in — Firebase determines which.

    POST body: { "idToken": "<firebase-id-token>", "name": "<display name>" }
    """
    id_token = request.data.get('idToken', '').strip()
    if not id_token:
        return Response({'error': 'idToken is required.'}, status=status.HTTP_400_BAD_REQUEST)

    # ── Verify token with Firebase Admin SDK ──
    # First check if Firebase Admin was even initialised at startup
    if not firebase_admin._apps:
        logger.error(
            'firebase_session: Firebase Admin SDK is NOT initialised. '
            'Check FIREBASE_PROJECT_ID and FIREBASE_PRIVATE_KEY in the environment.'
        )
        return Response({
            'error': 'Server error: Firebase Admin is not configured. '
                     'Check that FIREBASE_PROJECT_ID and FIREBASE_PRIVATE_KEY are set.',
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        decoded = firebase_auth.verify_id_token(id_token, clock_skew_seconds=60)
    except firebase_auth.ExpiredIdTokenError:
        logger.warning('firebase_session: token expired')
        return Response({'error': 'Session expired. Please sign in again.'}, status=status.HTTP_401_UNAUTHORIZED)
    except firebase_auth.RevokedIdTokenError:
        logger.warning('firebase_session: token revoked')
        return Response({'error': 'Session revoked. Please sign in again.'}, status=status.HTTP_401_UNAUTHORIZED)
    except firebase_auth.InvalidIdTokenError as e:
        logger.error('firebase_session: InvalidIdTokenError — %s', e)
        return Response({'error': f'Invalid token: {e}'}, status=status.HTTP_401_UNAUTHORIZED)
    except ValueError as e:
        logger.error('firebase_session: ValueError — %s', e)
        return Response({'error': f'Token error: {e}'}, status=status.HTTP_401_UNAUTHORIZED)
    except Exception as e:
        logger.exception('firebase_session: unexpected error — %s', e)
        return Response({'error': f'Authentication failed: {e}'}, status=status.HTTP_401_UNAUTHORIZED)

    uid          = decoded['uid']
    email        = decoded.get('email', '')
    display_name = (
        request.data.get('name')
        or decoded.get('name', '')
        or email.split('@')[0]
    )
    provider     = decoded.get('firebase', {}).get('sign_in_provider', 'password')
    provider_key = 'google' if 'google' in provider else 'email'

    # ── Upsert Django user (keyed on Firebase UID stored as username) ──
    user, created = User.objects.get_or_create(
        username=uid,
        defaults={
            'email':      email,
            'first_name': display_name,
            'provider':   provider_key,
        },
    )

    if not created:
        changed = False
        if email and user.email != email:
            user.email = email
            changed = True
        if display_name and not user.first_name:
            user.first_name = display_name
            changed = True
        if changed:
            user.save(update_fields=['email', 'first_name'])

    # ── Issue JWT cookies ──
    tokens   = _get_tokens(user)
    response = Response({
        'success': True,
        'created': created,
        'user':    UserSerializer(user).data,
        'access':  tokens['access'],
        'refresh': tokens['refresh'],
    })
    _set_auth_cookies(response, tokens)

    # ── Firestore sync (non-blocking) ──
    threading.Thread(
        target=_firestore_sync,
        args=(user, uid, created, email, provider_key),
        daemon=True,
    ).start()

    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def django_signup(request):
    email    = (request.data.get('email') or '').strip().lower()
    password = request.data.get('password') or ''
    name     = (request.data.get('name') or '').strip()

    if not email or not password:
        return Response({'error': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(password) < 6:
        return Response({'error': 'Password must be at least 6 characters long.'}, status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(email__iexact=email).exists():
        return Response({'error': 'An account with that email already exists.'}, status=status.HTTP_400_BAD_REQUEST)

    base_name = slugify(name) or 'user'
    username  = f'{base_name}-{uuid.uuid4().hex[:8]}'
    user      = User.objects.create_user(
        username=username, email=email, password=password, first_name=name
    )

    # Issue JWT directly — no need to re-authenticate a user we just created
    tokens   = _get_tokens(user)
    response = Response({
        'success': True,
        'user':    UserSerializer(user).data,
        'access':  tokens['access'],
        'refresh': tokens['refresh'],
    })
    _set_auth_cookies(response, tokens)
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def django_login(request):
    email    = (request.data.get('email') or '').strip().lower()
    password = request.data.get('password') or ''

    if not email or not password:
        return Response({'error': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

    # Check password directly — avoids allauth/social-auth backend interference
    if not user.check_password(password):
        return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

    tokens   = _get_tokens(user)
    response = Response({
        'success': True,
        'user':    UserSerializer(user).data,
        'access':  tokens['access'],
        'refresh': tokens['refresh'],
    })
    _set_auth_cookies(response, tokens)
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def logout(request):
    django_auth_logout(request)
    response = Response({'success': True})
    response.delete_cookie('access_token', path='/')
    response.delete_cookie('refresh_token', path='/')
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response({'user': UserSerializer(request.user).data})


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_profile(request):
    serializer = UpdateProfileSerializer(request.user, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response({'error': str(serializer.errors)}, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()

    uid = request.user.username
    def _sync():
        try:
            update_user_profile(uid, {
                'display_name':      request.user.first_name,
                'bio':               request.user.bio,
                'default_intensity': request.user.default_intensity,
                'default_persona':   request.user.default_persona,
                'topic_blacklist':   request.user.topic_blacklist,
            })
            log_profile_updated(uid)
        except Exception:
            logger.exception('Firestore profile update failed for uid=%s', uid)

    threading.Thread(target=_sync, daemon=True).start()
    return Response({'user': UserSerializer(request.user).data})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_account(request):
    uid = request.user.username
    request.user.delete()

    def _sync():
        try:
            delete_user_document(uid)
            log_account_deleted(uid)
        except Exception:
            logger.exception('Firestore delete failed for uid=%s', uid)

    threading.Thread(target=_sync, daemon=True).start()

    response = Response({'success': True})
    response.delete_cookie('access_token',  path='/')
    response.delete_cookie('refresh_token', path='/')
    return response
