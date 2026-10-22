"""
firestore_service.py
Syncs user data to Firestore after authentication.

Firestore structure:
  users/{uid}/
    uid, email, display_name, provider, created_at, last_login,
    default_intensity, default_persona, bio, topic_blacklist

  activity_events/{auto-id}/
    event_type, uid, timestamp, ...event-specific fields
"""

import logging
from datetime import datetime, timezone

from firebase_admin import firestore

logger = logging.getLogger(__name__)

_db = None


def _get_db():
    """Lazy-init Firestore client (reuses the already-initialised Firebase app)."""
    global _db
    if _db is None:
        _db = firestore.client()
    return _db


# ── Activity Events ──────────────────────────────────────────────────────────

def _log_event(payload: dict) -> None:
    """Write a document to activity_events. Failures are logged, never raised."""
    try:
        db = _get_db()
        db.collection('activity_events').add(payload)
    except Exception:
        logger.exception('Firestore activity_event write failed: %s', payload.get('event_type'))


def log_signup(uid: str, email: str, provider: str) -> None:
    _log_event({
        'event_type': 'signup',
        'uid': uid,
        'email': email,
        'provider': provider,
        'timestamp': datetime.now(timezone.utc),
    })


def log_login(uid: str) -> None:
    _log_event({
        'event_type': 'login',
        'uid': uid,
        'timestamp': datetime.now(timezone.utc),
    })


def log_roast_sent(uid: str, conversation_id: str, intensity: str, persona: str) -> None:
    _log_event({
        'event_type': 'roast_sent',
        'uid': uid,
        'conversation_id': str(conversation_id),
        'intensity': intensity,
        'persona': persona,
        'timestamp': datetime.now(timezone.utc),
    })


def log_vote_cast(uid: str, message_id: int, action: str) -> None:
    _log_event({
        'event_type': 'vote_cast',
        'uid': uid,
        'message_id': message_id,
        'action': action,  # 'upvote' | 'unvote'
        'timestamp': datetime.now(timezone.utc),
    })


def log_profile_updated(uid: str) -> None:
    _log_event({
        'event_type': 'profile_updated',
        'uid': uid,
        'timestamp': datetime.now(timezone.utc),
    })


def log_account_deleted(uid: str) -> None:
    _log_event({
        'event_type': 'account_deleted',
        'uid': uid,
        'timestamp': datetime.now(timezone.utc),
    })


def sync_user(user, uid: str, is_new: bool) -> None:
    """
    Write (or update) a user document in Firestore.
    Called after every successful firebase_session authentication.

    Args:
        user:    Django User instance
        uid:     Firebase UID (same as user.username in our schema)
        is_new:  True on first sign-up, False on subsequent logins
    """
    try:
        db = _get_db()
        ref = db.collection('users').document(uid)
        now = datetime.now(timezone.utc)

        if is_new:
            # Full document on first sign-up
            ref.set({
                'uid':               uid,
                'email':             user.email,
                'display_name':      user.first_name or user.email.split('@')[0],
                'provider':          user.provider,
                'created_at':        now,
                'last_login':        now,
                'default_intensity': user.default_intensity,
                'default_persona':   user.default_persona,
                'bio':               user.bio,
                'topic_blacklist':   user.topic_blacklist,
                'roast_count':       0,
            })
            logger.info('Firestore: created user document for uid=%s', uid)
        else:
            # Partial update on login — only refresh mutable fields
            ref.set({
                'email':      user.email,
                'last_login': now,
            }, merge=True)
            logger.debug('Firestore: updated last_login for uid=%s', uid)

    except Exception:
        # Never block auth because of a Firestore write failure
        logger.exception('Firestore sync failed for uid=%s', uid)


def update_user_profile(uid: str, fields: dict) -> None:
    """
    Propagate profile changes to Firestore (called from update_profile view).
    Only writes fields that are present in the dict.
    """
    try:
        db = _get_db()
        db.collection('users').document(uid).set(fields, merge=True)
    except Exception:
        logger.exception('Firestore profile update failed for uid=%s', uid)


def delete_user_document(uid: str) -> None:
    """Remove the Firestore document when a user deletes their account."""
    try:
        db = _get_db()
        db.collection('users').document(uid).delete()
        logger.info('Firestore: deleted user document for uid=%s', uid)
    except Exception:
        logger.exception('Firestore delete failed for uid=%s', uid)
