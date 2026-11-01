"""
Diagnostic view to check Firebase configuration
Access at /diagnostic/ (only in DEBUG mode)
"""
import firebase_admin
from django.conf import settings
from django.http import JsonResponse


def firebase_diagnostic(request):
    """Returns Firebase Admin SDK initialization status"""
    if not settings.DEBUG:
        return JsonResponse({'error': 'Only available in DEBUG mode'}, status=403)
    
    return JsonResponse({
        'firebase_admin_initialized': bool(firebase_admin._apps),
        'firebase_project_id': settings.FIREBASE_PROJECT_ID or None,
        'firebase_web_config_api_key': settings.FIREBASE_WEB_CONFIG.get('apiKey', '')[:10] + '...' if settings.FIREBASE_WEB_CONFIG.get('apiKey') else None,
        'firebase_web_config_project_id': settings.FIREBASE_WEB_CONFIG.get('projectId') or None,
        'has_private_key': bool(settings.FIREBASE_WEB_CONFIG.get('apiKey')),
    })
