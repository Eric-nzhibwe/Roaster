from django.contrib import admin
from .models import Conversation, Message


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ('user', 'intensity', 'persona', 'created_at')
    list_filter = ('intensity', 'persona')


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('conversation', 'role', 'favorited', 'is_public', 'upvotes', 'created_at')
    list_filter = ('role', 'favorited', 'is_public')
