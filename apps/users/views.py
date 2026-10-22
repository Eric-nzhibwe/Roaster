from django.conf import settings
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


def get_tokens(user):
    refresh = RefreshToken.for_user(user)
    return {
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    }


def set_auth_cookies(response, tokens):
    secure = not settings.DEBUG
    response.set_cookie(
        'access_token', tokens['access'],
        max_age=7 * 24 * 3600,
        httponly=True, secure=secure, samesite='Lax', path='/'
    )
    response.set_cookie(
        'refresh_token', tokens['refresh'],
        max_age=30 * 24 * 3600,
        httponly=True, secure=secure, samesite='Lax', path='/'
    )


def _verify_firebase_token(id_token):
    """Verify Firebase ID token and return decoded claims, or raise."""
    return firebase_auth.verify_id_token(id_token)


@api_view(['POST'])
@permission_classes([AllowAny])
def firebase_session(request):
    """
    Exchange a Firebase ID token for a Django session (JWT cookies).
    Used by both login and signup flows — Firebase handles the distinction.
    POST body: { "idToken": "<firebase-id-token>", "name": "<optional display name>" }
    """
    id_token = request.data.get('idToken', '').strip()
    if not id_token:
        return Response({'error': 'idToken is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        decoded = _verify_firebase_token(id_token)
    except firebase_auth.ExpiredIdTokenError:
        return Response({'error': 'Session expired. Please sign in again.'}, status=status.HTTP_401_UNAUTHORIZED)
    except firebase_auth.InvalidIdTokenError:
        return Response({'error': 'Invalid token.'}, status=status.HTTP_401_UNAUTHORIZED)
    except Exception:
        return Response({'error': 'Authentication failed.'}, status=status.HTTP_401_UNAUTHORIZED)

    uid = decoded['uid']
    email = decoded.get('email', '')
    display_name = request.data.get('name') or decoded.get('name', '') or email.split('@')[0]
    provider = decoded.get('firebase', {}).get('sign_in_provider', 'password')
    provider_key = 'google' if 'google' in provider else 'email'

    # Get or create Django user keyed on Firebase UID (stored in username)
    user, created = User.objects.get_or_create(
        username=uid,
        defaults={
            'email': email,
            'first_name': display_name,
            'provider': provider_key,
        }
    )

    # Keep email/name in sync on every login
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

    tokens = get_tokens(user)
    response = Response({
        'success': True,
        'created': created,
        'user': UserSerializer(user).data,
    })
    set_auth_cookies(response, tokens)

    # Sync to Firestore (non-blocking — failures are logged, not raised)
    sync_user(user, uid, is_new=created)
    if created:
        log_signup(uid, email, provider_key)
    else:
        log_login(uid)

    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def logout(request):
    response = Response({'success': True})
    response.delete_cookie('access_token')
    response.delete_cookie('refresh_token')
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

    # Propagate changes to Firestore
    uid = request.user.username  # username stores Firebase UID
    update_user_profile(uid, {
        'display_name':      request.user.first_name,
        'bio':               request.user.bio,
        'default_intensity': request.user.default_intensity,
        'default_persona':   request.user.default_persona,
        'topic_blacklist':   request.user.topic_blacklist,
    })
    log_profile_updated(uid)

    return Response({'user': UserSerializer(request.user).data})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_account(request):
    uid = request.user.username
    request.user.delete()
    delete_user_document(uid)
    log_account_deleted(uid)
    response = Response({'success': True})
    response.delete_cookie('access_token')
    response.delete_cookie('refresh_token')
    return response
