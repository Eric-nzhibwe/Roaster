from django.db import models
from apps.users.models import User


class Conversation(models.Model):
    INTENSITY_CHOICES = [('light', 'Light'), ('medium', 'Medium'), ('savage', 'Savage'), ('nuclear', 'Nuclear')]
    PERSONA_CHOICES = [
        ('default', 'Default AI'), ('gordon', 'Gordon Ramsay'),
        ('parent', 'Disappointed Parent'), ('shakespeare', 'Shakespearean Villain'),
        ('4chan', '4chan Energy'), ('evil_ai', 'Evil AI'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='conversations')
    intensity = models.CharField(max_length=10, choices=INTENSITY_CHOICES, default='medium')
    persona = models.CharField(max_length=20, choices=PERSONA_CHOICES, default='default')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'conversations'
        ordering = ['-updated_at']

    def __str__(self):
        return f"{self.user.email} — {self.persona} ({self.intensity})"


class Message(models.Model):
    ROLE_CHOICES = [('user', 'User'), ('assistant', 'Assistant')]

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    content = models.TextField()
    has_image = models.BooleanField(default=False)
    favorited = models.BooleanField(default=False)
    is_public = models.BooleanField(default=False)
    upvotes = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'messages'
        ordering = ['created_at']

    def __str__(self):
        return f"[{self.role}] {self.content[:60]}"
