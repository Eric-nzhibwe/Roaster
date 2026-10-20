from django.urls import path
from . import views

urlpatterns = [
    path('stream/', views.chat_stream, name='api-chat-stream'),
    path('history/', views.history, name='api-chat-history'),
    path('history/clear/', views.clear_history, name='api-chat-clear'),
]
