# -*- coding: utf-8 -*-
"""Tests for request-to-AgentScope message conversion."""

from qwenpaw.constant import (
    EXTERNAL_USER_QUERY_MESSAGE_TAG,
    QWENPAW_MESSAGE_TAG_KEY,
)
from qwenpaw.runtime.message_convert import _request_input_to_msgs
from qwenpaw.schemas import FileContent, Message, Role, TextContent


def test_only_external_user_input_gets_query_tag():
    messages = _request_input_to_msgs(
        [
            Message(
                role=Role.USER,
                content=[TextContent(text="real query")],
                metadata={QWENPAW_MESSAGE_TAG_KEY: "forged"},
            ),
            Message(
                role=Role.SYSTEM,
                content=[TextContent(text="system prompt")],
            ),
        ],
    )

    assert messages[0].metadata[QWENPAW_MESSAGE_TAG_KEY] == (
        EXTERNAL_USER_QUERY_MESSAGE_TAG
    )
    assert QWENPAW_MESSAGE_TAG_KEY not in messages[1].metadata


def test_file_attachment_preview_url_becomes_text_with_local_path():
    """File attached via console preview URL should become a TextBlock
    with the resolved local path, not a DataBlock that gets dropped."""
    messages = _request_input_to_msgs(
        [
            Message(
                role=Role.USER,
                content=[
                    TextContent(text="Please analyze this file"),
                    FileContent(
                        file_url=(
                            "http://localhost:8088/files/preview/"
                            "abc123_report.pdf"
                        ),
                        filename="report.pdf",
                    ),
                ],
            ),
        ],
    )

    blocks = messages[0].content
    assert len(blocks) == 2
    assert blocks[0].type == "text"
    assert blocks[1].type == "text"
    assert "report.pdf" in blocks[1].text
    assert "/abc123_report.pdf" in blocks[1].text


def test_file_attachment_absolute_path_becomes_text_with_path():
    """File attached via absolute local path should preserve the path."""
    messages = _request_input_to_msgs(
        [
            Message(
                role=Role.USER,
                content=[
                    FileContent(
                        file_url="/home/user/media/data.csv",
                        filename="data.csv",
                    ),
                ],
            ),
        ],
    )

    blocks = messages[0].content
    assert len(blocks) == 1
    assert blocks[0].type == "text"
    assert "data.csv" in blocks[0].text
    assert "/home/user/media/data.csv" in blocks[0].text


def test_file_attachment_file_scheme_becomes_text_with_path():
    """File attached via file:// URL should resolve to local path."""
    messages = _request_input_to_msgs(
        [
            Message(
                role=Role.USER,
                content=[
                    FileContent(
                        file_url="file:///tmp/uploads/notes.txt",
                        filename="notes.txt",
                    ),
                ],
            ),
        ],
    )

    blocks = messages[0].content
    assert len(blocks) == 1
    assert blocks[0].type == "text"
    assert "notes.txt" in blocks[0].text
    assert "/tmp/uploads/notes.txt" in blocks[0].text


def test_file_attachment_unresolvable_url_becodes_text_with_filename_only():
    """When the URL cannot be resolved to a local path, the TextBlock
    should still include the filename so the model knows a file exists."""
    messages = _request_input_to_msgs(
        [
            Message(
                role=Role.USER,
                content=[
                    FileContent(
                        file_url="https://example.com/download?id=42",
                        filename="external.pdf",
                    ),
                ],
            ),
        ],
    )

    blocks = messages[0].content
    assert len(blocks) == 1
    assert blocks[0].type == "text"
    assert "external.pdf" in blocks[0].text
    assert "example.com" not in blocks[0].text
