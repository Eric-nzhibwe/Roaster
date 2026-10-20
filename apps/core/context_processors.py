from django.conf import settings


def firebase_config(request):
    """Inject Firebase Web SDK config into all templates."""
    return {'FIREBASE_CONFIG': settings.FIREBASE_WEB_CONFIG}
