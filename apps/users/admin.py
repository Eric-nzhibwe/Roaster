from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ('email', 'first_name', 'default_intensity', 'default_persona', 'date_joined')
    list_filter = ('default_intensity', 'default_persona', 'provider')
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Roaster Profile', {'fields': ('bio', 'default_intensity', 'default_persona', 'topic_blacklist', 'provider')}),
    )
