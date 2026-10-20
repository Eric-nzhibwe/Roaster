from django.urls import path
from . import views

urlpatterns = [
    path('favorite/', views.toggle_favorite, name='api-favorite'),
    path('upvote/', views.toggle_upvote, name='api-upvote'),
    path('public/', views.toggle_public, name='api-public'),
    path('leaderboard/', views.leaderboard, name='api-leaderboard'),
]
