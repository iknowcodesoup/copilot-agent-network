"""Settings must boot the app with no environment file at all."""

import pytest

from pythonapi.config import Settings

# Secrets have no safe default. The rest are optional integrations where None
# means "off". See the Settings docstring.
#
# The two *_AGENT_A2A_URL entries are a third, narrower case: None means the
# specialist is mounted in this process, so the Orchestrator reaches it over an
# in-process transport instead of a URL. A default URL here would point at a
# port nothing listens on in the default single-process topology.
MAY_BE_NONE = frozenset(
    {
        "LANGFUSE_HOST",
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_RELEASE",
        "LANGFUSE_SECRET_KEY",
        "LLM_API_KEY",
        "PII_VAULT_ENCRYPTION_KEY",
        "PII_VAULT_SALT",
        "POSTGRES_URL",
        "QDRANT_API_KEY",
        "REDIS_URL",
        "RESEARCH_AGENT_A2A_URL",
        "VOICE_AGENT_A2A_URL",
        "VOICE_FACTORY_URL",
        "VOICE_WEBHOOK_TOKEN",
    }
)


@pytest.fixture
def settings_without_environment(monkeypatch):
    for field_name in Settings.model_fields:
        monkeypatch.delenv(field_name, raising=False)
    return Settings()


def test_allow_list_matches_real_field_names():
    unknown = MAY_BE_NONE - set(Settings.model_fields)
    assert not unknown, f"MAY_BE_NONE names fields that no longer exist: {unknown}"


def test_every_other_field_has_a_default(settings_without_environment):
    missing = {
        field_name
        for field_name in Settings.model_fields
        if field_name not in MAY_BE_NONE
        and getattr(settings_without_environment, field_name) is None
    }
    assert not missing, (
        f"These fields default to None but are not in MAY_BE_NONE: {missing}. "
        "Give each a real default, or add it to MAY_BE_NONE with a reason."
    )


@pytest.mark.parametrize(
    ("field_name", "expected_type"),
    [
        ("EMBEDDING_DIM", int),
        ("EMBEDDING_FAILURE_RATE", float),
        ("EMBEDDING_MAX_RETRIES", int),
        ("EMBEDDING_RETRY_BASE_DELAY", float),
        ("EMBEDDING_RETRY_MAX_DELAY", float),
        ("EMBEDDING_WORKER_COUNT", int),
        ("RATE_LIMIT_STORAGE_URI", str),
        ("SEARCH_CACHE_CAPACITY", int),
        ("SEARCH_RATE_LIMIT", str),
    ],
)
def test_values_passed_straight_into_constructors(
    settings_without_environment, field_name, expected_type
):
    """main.py passes these explicitly, which overrides the constructor
    defaults, so only Settings can supply them."""
    assert isinstance(getattr(settings_without_environment, field_name), expected_type)


def test_default_providers_need_no_network(settings_without_environment):
    assert settings_without_environment.EMBEDDING_PROVIDER == "mock"
    assert settings_without_environment.RERANK_PROVIDER == "mock"
    assert settings_without_environment.GENERATION_PROVIDER == "mock"
    assert settings_without_environment.QDRANT_URL == ":memory:"


def test_default_dimension_matches_default_embedding_provider(
    settings_without_environment,
):
    """Qdrant fixes a collection's vector size at creation, and the mock
    provider hashes into 64 dimensions."""
    assert settings_without_environment.EMBEDDING_PROVIDER == "mock"
    assert settings_without_environment.EMBEDDING_DIM == 64


def test_environment_variable_overrides_the_default(monkeypatch):
    monkeypatch.setenv("EMBEDDING_DIM", "768")
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openai_compatible")
    settings = Settings()
    assert settings.EMBEDDING_DIM == 768
    assert settings.EMBEDDING_PROVIDER == "openai_compatible"


def test_cors_origins_split_on_comma(monkeypatch):
    monkeypatch.setenv(
        "CORS_ALLOW_ORIGINS", "http://localhost:4001, http://localhost:3000"
    )
    assert Settings().cors_allow_origins == [
        "http://localhost:4001",
        "http://localhost:3000",
    ]
