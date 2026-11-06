import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'django-insecure-dev-key-change-in-production')
DEBUG = os.environ.get('DEBUG', 'True') == 'True'
ALLOWED_HOSTS = [host.strip() for host in os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if host.strip()]
if 'testserver' not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append('testserver')

# Security hardening (active when DEBUG=False)
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    # Local
    'apps.users',
    'apps.chat',
    'apps.roasts',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'apps.core.context_processors.firebase_config',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Database
import urllib.parse as urlparse


def get_database_config(database_url=None, use_postgres_local=None):
    """Return DB settings for local development and production.

    Local SQLite is the default so the app can run without a local Postgres
    service. Postgres is only used when DATABASE_URL is set to a non-local host,
    or when USE_POSTGRES_LOCAL is explicitly enabled for localhost development.
    """
    if database_url is None:
        database_url = os.environ.get('DATABASE_URL', '').strip()
    if use_postgres_local is None:
        use_postgres_local = os.environ.get('USE_POSTGRES_LOCAL', '').strip().lower() in {'1', 'true', 'yes', 'on'}

    if not database_url:
        return {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }

    url = urlparse.urlparse(database_url)
    host = (url.hostname or '').lower()
    if host in {'localhost', '127.0.0.1', '::1'} and not use_postgres_local:
        print('[settings] DATABASE_URL points to localhost Postgres but USE_POSTGRES_LOCAL is not enabled; falling back to SQLite for local development.')
        return {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }

    return {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': url.path[1:],
        'USER': url.username,
        'PASSWORD': url.password,
        'HOST': url.hostname,
        'PORT': url.port or 5432,
    }


DATABASES = {'default': get_database_config()}

AUTH_USER_MODEL = 'users.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 6}},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'apps.users.authentication.CookieJWTAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticatedOrReadOnly',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
}

# JWT
from datetime import timedelta
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(days=7),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'AUTH_COOKIE': 'access_token',
    'AUTH_COOKIE_SECURE': not DEBUG,
    'AUTH_COOKIE_HTTP_ONLY': True,
    'AUTH_COOKIE_SAMESITE': 'Lax',
}

# CORS
CORS_ALLOWED_ORIGINS = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
]
_render_url = os.environ.get('RENDER_EXTERNAL_URL', '')
if _render_url:
    CORS_ALLOWED_ORIGINS.append(_render_url)
CORS_ALLOW_CREDENTIALS = True

# CSRF
CSRF_COOKIE_HTTPONLY = False  # Allow JS to read CSRF token
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_TRUSTED_ORIGINS = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
]
if _render_url:
    CSRF_TRUSTED_ORIGINS.append(_render_url.rstrip('/'))
else:
    # Fallback: trust all onrender.com subdomains when RENDER_EXTERNAL_URL isn't set
    CSRF_TRUSTED_ORIGINS.append('https://*.onrender.com')

print(f'[settings] CSRF_TRUSTED_ORIGINS: {CSRF_TRUSTED_ORIGINS}')

# Groq
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')

# Firebase Admin SDK
import firebase_admin
from firebase_admin import credentials as fb_credentials

_firebase_private_key = os.environ.get('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n')

FIREBASE_PROJECT_ID = os.environ.get('FIREBASE_PROJECT_ID', '')

if not FIREBASE_PROJECT_ID:
    import warnings
    warnings.warn(
        "\n\n*** FIREBASE_PROJECT_ID is not set. ***\n"
        "Firebase Admin SDK will NOT be initialised.\n"
        "All calls to verify_id_token() will raise ValueError and return 401.\n"
        "Set FIREBASE_PROJECT_ID (and all other FIREBASE_* vars) in your .env or Render dashboard.\n",
        RuntimeWarning,
        stacklevel=2,
    )
elif firebase_admin._apps:
    # Already initialised (e.g. during hot-reload) — skip
    pass
else:
    try:
        _fb_cred = fb_credentials.Certificate({
            "type": "service_account",
            "project_id": FIREBASE_PROJECT_ID,
            "private_key_id": os.environ.get('FIREBASE_PRIVATE_KEY_ID', ''),
            "private_key": _firebase_private_key,
            "client_email": os.environ.get('FIREBASE_CLIENT_EMAIL', ''),
            "client_id": os.environ.get('FIREBASE_CLIENT_ID', ''),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_x509_cert_url": os.environ.get('FIREBASE_CLIENT_CERT_URL', ''),
        })
        firebase_admin.initialize_app(_fb_cred)
        print(f'[settings] Firebase Admin SDK initialised for project: {FIREBASE_PROJECT_ID}')
    except Exception as e:
        print(f'\n[settings] *** Firebase Admin SDK FAILED to initialise ***')
        print(f'[settings] Error: {e}')
        print(f'[settings] verify_id_token() will fail and all logins will return 401.')
        print(f'[settings] Common fixes:')
        print(f'[settings]   - FIREBASE_PRIVATE_KEY must contain \\n (literal backslash-n), not real newlines')
        print(f'[settings]   - All FIREBASE_* env vars must be non-empty')
        print(f'[settings]   - Service account must be from the same project as the web SDK\n')

# Firebase Web SDK config (injected into templates via context processor)
FIREBASE_WEB_CONFIG = {
    'apiKey': os.environ.get('FIREBASE_API_KEY', ''),
    'authDomain': os.environ.get('FIREBASE_AUTH_DOMAIN', ''),
    'projectId': FIREBASE_PROJECT_ID,
    'messagingSenderId': os.environ.get('FIREBASE_MESSAGING_SENDER_ID', ''),
    'appId': os.environ.get('FIREBASE_APP_ID', ''),
}
