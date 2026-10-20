"""
firestore_service.py
Syncs user data to Firestore after authentication.

Firestore structure:
  users/{uid}/
    uid, email, display_name, provider, created_at, last_login,
    default_intensity, default_persona, bio, topic_blacklist
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
