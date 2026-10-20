from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


class CookieJWTAuthentication(JWTAuthentication):
    """Read the JWT access token from the 'access_token' httpOnly cookie."""

    def authenticate(self, request):
        raw_token = request.COOKIES.get('access_token')
        if raw_token is None:
            return None
        try:
            validated = self.get_validated_token(raw_token)
        except TokenError as e:
            raise InvalidToken(e.args[0])
        return self.get_user(validated), validated
