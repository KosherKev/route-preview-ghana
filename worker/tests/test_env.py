import os


def test_token_absent_from_environment():
    assert "MAPILLARY_TOKEN" not in os.environ
    print("MAPILLARY_TOKEN absent: confirmed")
