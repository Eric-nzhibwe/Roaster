from django.urls import path
from . import views

urlpatterns = [
    path('firebase-session/', views.firebase_session, name='api-firebase-session'),
    path('logout/', views.logout, name='api-logout'),
    path('me/', views.me, name='api-me'),
    path('profile/', views.update_profile, name='api-profile'),
    path('delete/', views.delete_account, name='api-delete-account'),
]
