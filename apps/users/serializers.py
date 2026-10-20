from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import User


class SignupSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=6)

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'password')

    def validate_email(self, value):
        if User.objects.filter(email=value.lower()).exists():
            raise serializers.ValidationError('Email already in use.')
        return value.lower()

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['email'].split('@')[0] + str(User.objects.count()),
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', ''),
        )
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, data):
        try:
            user = User.objects.get(email=data['email'].lower())
        except User.DoesNotExist:
            raise serializers.ValidationError('Invalid credentials.')
        user = authenticate(username=user.username, password=data['password'])
        if not user:
            raise serializers.ValidationError('Invalid credentials.')
        data['user'] = user
        return data


class UserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'name', 'email', 'bio', 'default_intensity', 'default_persona', 'topic_blacklist', 'date_joined')

    def get_name(self, obj):
        return obj.get_full_name() or obj.username


class UpdateProfileSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='first_name', required=False)

    class Meta:
        model = User
        fields = ('name', 'bio', 'default_intensity', 'default_persona', 'topic_blacklist')
