from django.shortcuts import render, redirect
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from apps.users.authentication import CookieJWTAuthentication

LANDING_CONTEXT = {
    'stats': [
        {'value': '2.4M+', 'label': 'Roasts Delivered'},
        {'value': '98%', 'label': 'Ego Destruction Rate'},
        {'value': '5', 'label': 'Savage Personas'},
        {'value': '0', 'label': 'Feelings Spared'},
    ],
    'personas': [
        {'icon': '<i class="fa-solid fa-robot"></i>', 'name': 'Default AI'},
        {'icon': '<i class="fa-solid fa-utensils"></i>', 'name': 'Gordon Ramsay'},
        {'icon': '<i class="fa-solid fa-heart-crack"></i>', 'name': 'Disappointed Parent'},
        {'icon': '<i class="fa-solid fa-masks-theater"></i>', 'name': 'Shakespeare'},
        {'icon': '<i class="fa-solid fa-skull"></i>', 'name': '4chan Energy'},
    ],
    'features': [
        {'icon': '<i class="fa-solid fa-image"></i>', 'title': 'Vision Roasting', 'desc': 'Upload a photo and let the AI analyze every inch of your questionable life choices.'},
        {'icon': '<i class="fa-solid fa-bolt"></i>', 'title': 'Streaming Speed', 'desc': 'Powered by Groq — responses so fast the burn lands before you can brace.'},
        {'icon': '<i class="fa-solid fa-sliders"></i>', 'title': '4 Intensity Levels', 'desc': 'From gentle teasing to full nuclear annihilation. You choose the damage.'},
        {'icon': '<i class="fa-solid fa-scroll"></i>', 'title': 'Roast History', 'desc': 'All your burns saved. Revisit your lowest moments anytime.'},
        {'icon': '<i class="fa-solid fa-trophy"></i>', 'title': 'Public Leaderboard', 'desc': 'The most savage burns go public. Fame through humiliation.'},
        {'icon': '<i class="fa-solid fa-shield-halved"></i>', 'title': 'Topic Blacklist', 'desc': "Set bounds. Some things are off-limits even in a roast."},
    ],
}

def _check_auth(request):
    """Returns True if the request is authenticated via Django session or JWT cookie."""
    if getattr(request.user, 'is_authenticated', False):
        return True
    try:
        auth = CookieJWTAuthentication()
        user_auth = auth.authenticate(request)
        return user_auth is not None
    except (InvalidToken, TokenError, AuthenticationFailed):
        return False

def landing(request):
    return render(request, 'pages/landing.html', LANDING_CONTEXT)

def login_page(request):
    # Redirect to chat if already logged in
    if _check_auth(request):
        return redirect('/chat/')
    return render(request, 'pages/auth.html')

def signup_page(request):
    # Redirect to chat if already logged in
    if _check_auth(request):
        return redirect('/chat/')
    return render(request, 'pages/auth.html')

def chat_page(request):
    # Redirect to auth if not logged in
    if not _check_auth(request):
        return redirect('/auth/')
    return render(request, 'pages/chat.html')

def history_page(request):
    if not _check_auth(request):
        return redirect('/auth/')
    return render(request, 'pages/history.html')

def leaderboard_page(request):
    return render(request, 'pages/leaderboard.html')

def profile_page(request):
    if not _check_auth(request):
        return redirect('/auth/')
    return render(request, 'pages/profile.html')
