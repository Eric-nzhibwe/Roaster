from django.urls import path
from django.views.decorators.csrf import ensure_csrf_cookie
from django.http import JsonResponse
from . import views

@ensure_csrf_cookie
def csrf_seed(request):
    return JsonResponse({'ok': True})

urlpatterns = [
    path('csrf/', csrf_seed, name='api-csrf'),
    path('firebase-session/', views.firebase_session, name='api-firebase-session'),
    path('logout/', views.logout, name='api-logout'),
    path('me/', views.me, name='api-me'),
    path('profile/', views.update_profile, name='api-profile'),
    path('delete/', views.delete_account, name='api-delete-account'),
]
