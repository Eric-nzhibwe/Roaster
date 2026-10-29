from django.urls import path
from . import views

urlpatterns = [
    path('', views.landing, name='landing'),
    # Unified auth page
    path('auth/', views.login_page, name='auth'),
    # Legacy routes kept as aliases — redirect to same view
    path('login/', views.login_page, name='login'),
    path('signup/', views.signup_page, name='signup'),
    path('chat/', views.chat_page, name='chat'),
    path('history/', views.history_page, name='history'),
    path('leaderboard/', views.leaderboard_page, name='leaderboard'),
    path('profile/', views.profile_page, name='profile'),
]
