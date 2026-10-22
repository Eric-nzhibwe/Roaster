from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from apps.chat.models import Message
from apps.users.firestore_service import log_vote_cast
from .models import Vote


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def toggle_favorite(request):
    message_id = request.data.get('messageId')
    try:
        msg = Message.objects.get(id=message_id, conversation__user=request.user)
    except Message.DoesNotExist:
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    msg.favorited = not msg.favorited
    msg.save(update_fields=['favorited'])
    return Response({'favorited': msg.favorited})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def toggle_upvote(request):
    message_id = request.data.get('messageId')
    try:
        msg = Message.objects.get(id=message_id)
    except Message.DoesNotExist:
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    vote, created = Vote.objects.get_or_create(user=request.user, message=msg)
    if created:
        msg.upvotes += 1
        msg.save(update_fields=['upvotes'])
        log_vote_cast(uid=request.user.username, message_id=msg.id, action='upvote')
        return Response({'upvoted': True, 'upvotes': msg.upvotes})
    else:
        vote.delete()
        msg.upvotes = max(0, msg.upvotes - 1)
        msg.save(update_fields=['upvotes'])
        log_vote_cast(uid=request.user.username, message_id=msg.id, action='unvote')
        return Response({'upvoted': False, 'upvotes': msg.upvotes})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def toggle_public(request):
    message_id = request.data.get('messageId')
    try:
        msg = Message.objects.get(id=message_id, conversation__user=request.user)
    except Message.DoesNotExist:
        return Response({'error': 'Message not found'}, status=status.HTTP_404_NOT_FOUND)

    msg.is_public = not msg.is_public
    msg.save(update_fields=['is_public'])
    return Response({'is_public': msg.is_public})


@api_view(['GET'])
@permission_classes([AllowAny])
def leaderboard(request):
    top_roasts = Message.objects.filter(
        role='assistant',
        is_public=True,
        upvotes__gt=0,
    ).select_related('conversation__user').order_by('-upvotes')[:50]

    return Response({
        'roasts': [
            {
                'id': m.id,
                'content': m.content,
                'upvotes': m.upvotes,
                'created_at': m.created_at.isoformat(),
                'intensity': m.conversation.intensity,
                'persona': m.conversation.persona,
                'user_name': m.conversation.user.get_full_name() or m.conversation.user.username,
            }
            for m in top_roasts
        ]
    })
