"""
Management command: create_superuser_env

Creates a superuser from environment variables. Safe to call repeatedly —
skips creation if the user already exists.

Required env vars:
    DJANGO_SUPERUSER_EMAIL
    DJANGO_SUPERUSER_PASSWORD

Optional env vars:
    DJANGO_SUPERUSER_USERNAME  (defaults to 'admin')
    DJANGO_SUPERUSER_NAME      (display name, defaults to 'Admin')

Usage:
    python manage.py create_superuser_env

Add to build.sh to auto-provision on Render:
    python manage.py create_superuser_env
"""

import os
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model


class Command(BaseCommand):
    help = 'Create a superuser from environment variables (idempotent)'

    def handle(self, *args, **options):
        User = get_user_model()

        email    = os.environ.get('DJANGO_SUPERUSER_EMAIL', '').strip()
        password = os.environ.get('DJANGO_SUPERUSER_PASSWORD', '').strip()
        username = os.environ.get('DJANGO_SUPERUSER_USERNAME', 'admin').strip()
        name     = os.environ.get('DJANGO_SUPERUSER_NAME', 'Admin').strip()

        if not email or not password:
            self.stdout.write(self.style.WARNING(
                'Skipping superuser creation: '
                'DJANGO_SUPERUSER_EMAIL and DJANGO_SUPERUSER_PASSWORD must both be set.'
            ))
            return

        if User.objects.filter(email__iexact=email).exists():
            self.stdout.write(self.style.SUCCESS(
                f'Superuser already exists: {email} — skipping.'
            ))
            return

        # Also ensure username is unique
        if User.objects.filter(username=username).exists():
            username = f'{username}-admin'

        User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
            first_name=name,
        )

        self.stdout.write(self.style.SUCCESS(
            f'Superuser created: {email} (username: {username})'
        ))
