from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),

    # API routes
    path('api/auth/', include('apps.users.urls')),
    path('api/chat/', include('apps.chat.urls')),
    path('api/roasts/', include('apps.roasts.urls')),

    # Frontend pages (served by Django templates)
    path('', include('apps.core.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
