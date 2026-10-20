from django.db import models
from apps.users.models import User
from apps.chat.models import Message


class Vote(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='votes')
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='votes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'votes'
        unique_together = ('user', 'message')

    def __str__(self):
        return f"{self.user.email} → message #{self.message.id}"
