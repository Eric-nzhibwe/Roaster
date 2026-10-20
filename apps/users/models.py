from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Extended user model with roast preferences."""
    bio = models.TextField(blank=True, default='')
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    default_intensity = models.CharField(
        max_length=10,
        choices=[('light', 'Light'), ('medium', 'Medium'), ('savage', 'Savage'), ('nuclear', 'Nuclear')],
        default='medium',
    )
    default_persona = models.CharField(
        max_length=20,
        choices=[
            ('default', 'Default AI'),
            ('gordon', 'Gordon Ramsay'),
            ('parent', 'Disappointed Parent'),
            ('shakespeare', 'Shakespearean Villain'),
            ('4chan', '4chan Energy'),
            ('evil_ai', 'Evil AI'),
        ],
        default='default',
    )
    topic_blacklist = models.JSONField(default=list, blank=True)
    provider = models.CharField(max_length=20, default='email')  # email | google

    class Meta:
        db_table = 'users'

    def __str__(self):
        return self.email
