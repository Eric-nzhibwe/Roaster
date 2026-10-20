import json
import logging
from django.http import StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Conversation, Message
from .groq_service import stream_roast
from apps.users.authentication import CookieJWTAuthentication

logger = logging.getLogger(__name__)


def _get_user(request):
    """Authenticate via cookie JWT without DRF view wrapping."""
    try:
        result = CookieJWTAuthentication().authenticate(request)
        return result[0] if result else None
    except Exception:
        return None


@csrf_exempt
@require_POST
def chat_stream(request):
    """
    Plain Django view — DRF @api_view buffers StreamingHttpResponse,
    so we handle auth and parsing manually here.
    """
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        def err():
            yield 'data: {"error": "Invalid JSON"}\n\n'
            yield "data: [DONE]\n\n"
        return StreamingHttpResponse(err(), content_type='text/event-stream')

    history        = data.get('messages', [])
    intensity      = data.get('intensity', 'medium')
    persona        = data.get('persona', 'default')
    bio            = data.get('bio', '')
    image_base64   = data.get('imageBase64') or None
    conversation_id = data.get('conversationId') or None

    user = _get_user(request)
    topic_blacklist = user.topic_blacklist if user else []

    # Create / fetch conversation for authenticated users
    conversation = None
    if user:
        if conversation_id:
            try:
                conversation = Conversation.objects.get(id=conversation_id, user=user)
            except Conversation.DoesNotExist:
                pass
        if not conversation:
            conversation = Conversation.objects.create(
                user=user, intensity=intensity, persona=persona
            )
        last_msg = history[-1] if history else None
        if last_msg and last_msg.get('role') == 'user':
            Message.objects.create(
                conversation=conversation,
                role='user',
                content=last_msg.get('content', ''),
                has_image=bool(image_base64),
            )

    def sse_generator():
        full_response = ''
        try:
            if conversation:
                yield f"data: {json.dumps({'conversationId': str(conversation.id)})}\n\n"

            for delta in stream_roast(history, intensity, persona, bio, image_base64, topic_blacklist):
                full_response += delta
                yield f"data: {json.dumps({'choices': [{'delta': {'content': delta}}]})}\n\n"

            yield "data: [DONE]\n\n"

            if conversation and full_response:
                Message.objects.create(
                    conversation=conversation,
                    role='assistant',
                    content=full_response,
                )

        except Exception as e:
            logger.exception('chat_stream error: %s', e)
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    response = StreamingHttpResponse(sse_generator(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def history(request):
    page = int(request.GET.get('page', 1))
    favorites_only = request.GET.get('favorites') == 'true'
    per_page = 20
    offset = (page - 1) * per_page

    qs = Message.objects.filter(
        conversation__user=request.user,
        role='assistant',
    )
    if favorites_only:
        qs = qs.filter(favorited=True)

    qs = qs.select_related('conversation').order_by('-created_at')
    total = qs.count()
    messages = qs[offset:offset + per_page]

    return Response({
        'messages': [
            {
                'id': m.id,
                'content': m.content,
                'favorited': m.favorited,
                'is_public': m.is_public,
                'upvotes': m.upvotes,
                'created_at': m.created_at.isoformat(),
                'conversation': {
                    'intensity': m.conversation.intensity,
                    'persona': m.conversation.persona,
                },
            }
            for m in messages
        ],
        'total': total,
        'page': page,
        'pages': max(1, -(-total // per_page)),  # ceiling division
    })


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def clear_history(request):
    Conversation.objects.filter(user=request.user).delete()
    return Response({'success': True})
