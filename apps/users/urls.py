from django.urls import path
from django.views.decorators.csrf import ensure_csrf_cookie
from django.http import JsonResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken
from . import views

@ensure_csrf_cookie
def csrf_seed(request):
    return JsonResponse({'ok': True})

@api_view(['POST'])
@permission_classes([AllowAny])
def cookie_token_refresh(request):
    """
    Read the refresh token from the httpOnly cookie (not the request body)
    and issue a new access token cookie.
    """
    raw_refresh = request.COOKIES.get('refresh_token')
    if not raw_refresh:
        return Response(
            {'error': 'No refresh token — please sign in again.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    try:
        refresh = RefreshToken(raw_refresh)
        new_access = str(refresh.access_token)
    except (TokenError, InvalidToken):
        return Response(
            {'error': 'Session expired — please sign in again.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    from django.conf import settings
    response = Response({'success': True})
    response.set_cookie(
        'access_token', new_access,
        max_age=7 * 24 * 3600,
        httponly=True,
        secure=not settings.DEBUG,
        samesite='Lax',
        path='/',
    )
    return response

urlpatterns = [
    path('csrf/',             csrf_seed,            name='api-csrf'),
    path('firebase-session/', views.firebase_session, name='api-firebase-session'),
    path('token/refresh/',    cookie_token_refresh,  name='api-token-refresh'),
    path('logout/',           views.logout,          name='api-logout'),
    path('me/',               views.me,              name='api-me'),
    path('profile/',          views.update_profile,  name='api-profile'),
    path('delete/',           views.delete_account,  name='api-delete-account'),
]
