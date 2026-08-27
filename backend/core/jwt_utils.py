import ssl

import certifi
import jwt
from django.conf import settings
from jwt import PyJWKClient

_jwk_client = None


class InvalidSupabaseToken(Exception):
    pass


def _get_jwk_client():
    # Fetched once and cached in-process (PyJWKClient caches by kid) - this
    # is still "local" verification in the sense that matters: Supabase is
    # never called on the request path, only once to learn its public key.
    #
    # Use certifi's CA bundle via ssl_context. Stock macOS Python builds often
    # fail urllib SSL verify (CERTIFICATE_VERIFY_FAILED) when fetching JWKS,
    # which makes every ES256 login token look invalid → 403 on protected routes.
    global _jwk_client
    if _jwk_client is None:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        _jwk_client = PyJWKClient(
            f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            ssl_context=ssl_context,
        )
    return _jwk_client


def decode_supabase_jwt(token):
    """Verify a Supabase Auth JWT locally.

    Newer Supabase projects sign JWTs asymmetrically (ES256/RS256) and
    publish a JWKS endpoint instead of a shared secret; older projects
    still use HS256 with SUPABASE_JWT_SECRET. Handle both - which one a
    given project uses isn't something this code should have to guess
    ahead of time, so branch on the token's own header.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise InvalidSupabaseToken(str(exc)) from exc

    try:
        if header.get("alg") == "HS256":
            return jwt.decode(
                token,
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=[header["alg"]],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise InvalidSupabaseToken(str(exc)) from exc
