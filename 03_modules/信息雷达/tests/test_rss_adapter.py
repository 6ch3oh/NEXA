from __future__ import annotations

import ast
from dataclasses import fields
from datetime import UTC, datetime
from pathlib import Path
from unittest import TestCase, mock

from nexa_radar.adapters import ExternalItem
from nexa_radar.audit import RecommendationAuditBuilder
from nexa_radar.audit_reader import RecommendationAuditReader
from nexa_radar.dedup import DuplicateKind, canonical_identity, compare
from nexa_radar.domain import (
    ContentType,
    QualityScore,
    RadarEntry,
    RecommendationCategory,
    RecommendationCode,
    RecommendationReason,
    ScoreDimension,
    UserFeedback,
    UserState,
)
from nexa_radar.recommendation import RecommendationContext, RecommendationOrchestrator
from nexa_radar.rss_adapter import (
    RSS_ADAPTER_ID,
    SUMMARY_MAX_LENGTH,
    FeedFormat,
    FeedIngestionResult,
    FeedIssueCode,
    FeedParseResult,
    OfflineFeedParser,
    OfflineRssAdapter,
    sanitize_feed_summary,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"
RSS_XML = (FIXTURE_DIR / "rss_normal.xml").read_bytes()
ATOM_XML = (FIXTURE_DIR / "atom_normal.xml").read_bytes()
MALFORMED_XML = (FIXTURE_DIR / "malformed_feed.xml").read_bytes()
DISCOVERED = datetime(2026, 8, 10, 6, 0, tzinfo=UTC)


def _adapter(name: str = "rss-normal") -> OfflineRssAdapter:
    return OfflineRssAdapter(feed_ref=f"fixture:{name}", source_display_name="Configured RSS Fixture")


def _rss_result() -> FeedIngestionResult:
    return _adapter().ingest(RSS_XML, discovered_at=DISCOVERED)


def _atom_result() -> FeedIngestionResult:
    return _adapter("atom-normal").ingest(ATOM_XML, discovered_at=DISCOVERED)


def _recommendation_entries(result: FeedIngestionResult) -> tuple[RadarEntry, ...]:
    entries: list[RadarEntry] = []
    for index, item in enumerate(result.items):
        category = RecommendationCategory.ADJACENT if index == 2 else RecommendationCategory.CURRENT
        code = RecommendationCode.ADJACENT_FIELD if category is RecommendationCategory.ADJACENT else RecommendationCode.CURRENT_INTEREST
        entries.append(
            RadarEntry(
                item=item,
                quality=QualityScore(
                    (ScoreDimension("fixture", 85, "Offline RSS adapter fixture evidence."),),
                    "rss-fixture-scorer",
                    "1.0",
                    is_final=True,
                ),
                recommendation_reasons=(
                    RecommendationReason(code, category, "Offline RSS adapter compatibility fixture."),
                ),
                project_relations=(),
                user_feedback=UserFeedback(item.item_id, UserState.DEFAULT, DISCOVERED),
            )
        )
    return tuple(entries)


class FeedParserContractTests(TestCase):
    def test_rss_2_0_normal_parse(self) -> None:
        result = OfflineFeedParser().parse(RSS_XML, feed_ref="fixture:rss-normal")
        self.assertIsInstance(result, FeedParseResult)
        self.assertEqual(result.feed_format, FeedFormat.RSS_2_0)
        self.assertEqual(result.parsed_count, 6)
        self.assertEqual(result.accepted_count, 4)
        self.assertEqual(result.rejected_count, 2)
        self.assertFalse(result.fatal)

    def test_atom_normal_parse(self) -> None:
        result = OfflineFeedParser().parse(ATOM_XML, feed_ref="fixture:atom-normal")
        self.assertEqual(result.feed_format, FeedFormat.ATOM)
        self.assertEqual(result.parsed_count, 4)
        self.assertEqual(result.accepted_count, 3)
        self.assertEqual(result.rejected_count, 1)

    def test_rss_feed_title(self) -> None:
        self.assertEqual(_rss_result().feed_title, "NEXA RSS Fixture")
        self.assertEqual(_rss_result().source.display_name, "NEXA RSS Fixture")

    def test_atom_feed_title(self) -> None:
        self.assertEqual(_atom_result().feed_title, "NEXA Atom Fixture")
        self.assertEqual(_atom_result().source.display_name, "NEXA Atom Fixture")

    def test_parser_accepts_xml_string_and_bytes(self) -> None:
        parser = OfflineFeedParser()
        from_bytes = parser.parse(RSS_XML, feed_ref="fixture:rss-normal")
        from_text = parser.parse(RSS_XML.decode("utf-8"), feed_ref="fixture:rss-normal")
        self.assertEqual(from_bytes, from_text)

    def test_dtd_and_entity_declarations_are_rejected_before_parsing(self) -> None:
        xml = b'<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///private">]><rss>&xxe;</rss>'
        result = OfflineFeedParser().parse(xml, feed_ref="fixture:unsafe")
        self.assertTrue(result.fatal)
        self.assertEqual(result.issues[0].code, FeedIssueCode.UNSAFE_XML)

    def test_declaration_text_inside_cdata_is_not_a_false_positive(self) -> None:
        xml = b'''<rss version="2.0"><channel><title>Code Feed</title><item>
        <title>XML safety article</title><guid>code-1</guid><link>https://example.com/code</link>
        <description><![CDATA[An example says <!ENTITY unsafe SYSTEM "file:///x"> but does not declare it.]]></description>
        </item></channel></rss>'''
        result = OfflineRssAdapter(feed_ref="https://example.com/feed").ingest(xml, discovered_at=DISCOVERED)
        self.assertFalse(result.fatal)
        self.assertEqual(result.accepted_count, 1)

    def test_unsupported_root_is_fatal(self) -> None:
        result = OfflineFeedParser().parse("<catalog><title>x</title></catalog>", feed_ref="fixture:unsupported")
        self.assertTrue(result.fatal)
        self.assertEqual(result.issues[0].code, FeedIssueCode.UNSUPPORTED_FORMAT)

    def test_malformed_feed_is_structured_fatal_failure(self) -> None:
        result = _adapter("broken").ingest(MALFORMED_XML, discovered_at=DISCOVERED)
        self.assertTrue(result.fatal)
        self.assertEqual(result.accepted_count, 0)
        self.assertEqual(result.issues[0].code, FeedIssueCode.MALFORMED_XML)

    def test_entry_level_errors_do_not_fail_whole_feed(self) -> None:
        result = _rss_result()
        self.assertFalse(result.fatal)
        self.assertEqual(result.accepted_count, 4)
        self.assertEqual(result.rejected_count, 2)

    def test_missing_title_is_rejected(self) -> None:
        self.assertTrue(any(issue.code is FeedIssueCode.MISSING_ENTRY_TITLE for issue in _rss_result().issues))

    def test_missing_identity_is_rejected(self) -> None:
        self.assertTrue(any(issue.code is FeedIssueCode.MISSING_ENTRY_IDENTITY for issue in _rss_result().issues))

    def test_invalid_entry_datetime_is_rejected(self) -> None:
        xml = """<rss version='2.0'><channel><title>x</title><item><title>bad date</title><guid>1</guid><pubDate>not-a-date</pubDate></item></channel></rss>"""
        result = OfflineFeedParser().parse(xml, feed_ref="fixture:bad-date")
        self.assertEqual(result.accepted_count, 0)
        self.assertEqual(result.issues[0].code, FeedIssueCode.INVALID_ENTRY_DATETIME)

    def test_invalid_entry_link_is_rejected(self) -> None:
        xml = """<rss version='2.0'><channel><title>x</title><item><title>bad link</title><guid>1</guid><link>/relative</link></item></channel></rss>"""
        result = OfflineFeedParser().parse(xml, feed_ref="fixture:bad-link")
        self.assertEqual(result.accepted_count, 0)
        self.assertEqual(result.issues[0].code, FeedIssueCode.INVALID_ENTRY_LINK)

    def test_secret_like_link_query_is_rejected(self) -> None:
        xml = """<rss version='2.0'><channel><title>x</title><item><title>secret link</title><guid>1</guid><link>https://content.invalid/item?access_token=fixture</link></item></channel></rss>"""
        result = OfflineFeedParser().parse(xml, feed_ref="fixture:secret-link")
        self.assertEqual(result.accepted_count, 0)
        self.assertEqual(result.issues[0].code, FeedIssueCode.INVALID_ENTRY_LINK)


class IdentityAndMappingTests(TestCase):
    def setUp(self) -> None:
        self.rss = _rss_result()
        self.atom = _atom_result()

    def test_rss_guid_identity(self) -> None:
        external = self.rss.external_items[0]
        self.assertTrue(external.provider_item_id.startswith("rss-guid:"))
        self.assertEqual(external.provider_fields["identity_basis"], "explicit_id")

    def test_atom_id_identity(self) -> None:
        external = self.atom.external_items[0]
        self.assertTrue(external.provider_item_id.startswith("atom-id:"))
        self.assertEqual(external.provider_fields["identity_basis"], "explicit_id")

    def test_link_fallback_identity(self) -> None:
        external = self.rss.external_items[1]
        self.assertTrue(external.provider_item_id.startswith("link:"))
        self.assertEqual(external.provider_fields["identity_basis"], "canonical_link")

    def test_deterministic_stable_fields_fallback_identity(self) -> None:
        external = self.rss.external_items[2]
        self.assertTrue(external.provider_item_id.startswith("fallback:"))
        self.assertEqual(external.provider_fields["identity_basis"], "stable_fields")
        self.assertTrue(external.target_ref.startswith("rss-item:"))

    def test_repeated_parse_produces_same_provider_and_domain_identity(self) -> None:
        again = _rss_result()
        self.assertEqual(
            [item.provider_item_id for item in self.rss.external_items],
            [item.provider_item_id for item in again.external_items],
        )
        self.assertEqual([item.item_id for item in self.rss.items], [item.item_id for item in again.items])

    def test_feed_source_identity_is_stable(self) -> None:
        first = OfflineRssAdapter(feed_ref="fixture:stable-feed", source_display_name="First")
        second = OfflineRssAdapter(feed_ref="fixture:stable-feed", source_display_name="Second")
        self.assertEqual(first.source.instance_id, second.source.instance_id)
        self.assertEqual(first.source.kind.value, "RSS")

    def test_local_absolute_path_cannot_be_feed_identity(self) -> None:
        with self.assertRaises(ValueError):
            OfflineRssAdapter(feed_ref=r"E:\private\feed.xml")
        with self.assertRaises(ValueError):
            OfflineRssAdapter(feed_ref="file:///private/feed.xml")

    def test_existing_external_item_contract_is_used(self) -> None:
        self.assertTrue(all(isinstance(item, ExternalItem) for item in self.rss.external_items))

    def test_title_mapping(self) -> None:
        self.assertEqual(self.rss.items[0].title, "Deterministic feed adapters")
        self.assertEqual(self.atom.items[0].title, "Atom published entry")

    def test_default_content_type_is_article_without_keyword_guessing(self) -> None:
        self.assertTrue(all(item.content_type is ContentType.ARTICLE for item in (*self.rss.items, *self.atom.items)))

    def test_summary_mapping_and_missing_summary_fallback(self) -> None:
        self.assertEqual(self.rss.items[0].summary, "A safe adapter & mapping example.")
        self.assertEqual(self.rss.items[1].summary, "No summary provided.")
        self.assertEqual(self.atom.items[2].summary, "No summary provided.")

    def test_html_tags_and_script_style_are_removed(self) -> None:
        summary = self.rss.items[0].summary
        self.assertNotIn("<", summary)
        self.assertNotIn("steal-cookie", summary)
        self.assertNotIn("hidden", summary)
        self.assertNotIn("script", self.atom.items[1].summary.casefold())

    def test_html_entities_are_decoded(self) -> None:
        self.assertIn("&", self.rss.items[0].summary)
        self.assertIn("Atom & entity", self.atom.items[0].summary)

    def test_summary_length_is_bounded(self) -> None:
        result = sanitize_feed_summary("<p>" + ("x" * 800) + "</p>")
        self.assertEqual(len(result), SUMMARY_MAX_LENGTH)
        self.assertTrue(result.endswith("…"))

    def test_rss_pubdate_is_normalized_to_utc(self) -> None:
        self.assertEqual(self.rss.items[0].published_at, datetime(2026, 8, 10, 0, 30, tzinfo=UTC))

    def test_atom_published_is_normalized_to_utc(self) -> None:
        self.assertEqual(self.atom.items[0].published_at, datetime(2026, 8, 10, 1, 2, 3, tzinfo=UTC))

    def test_atom_updated_is_fallback_and_normalized(self) -> None:
        self.assertEqual(self.atom.items[1].published_at, datetime(2026, 8, 10, 2, 30, tzinfo=UTC))

    def test_missing_publish_date_stays_none(self) -> None:
        self.assertIsNone(self.rss.items[1].published_at)
        self.assertIsNone(self.atom.items[2].published_at)

    def test_discovered_at_is_injected(self) -> None:
        self.assertTrue(all(item.discovered_at == DISCOVERED for item in (*self.rss.items, *self.atom.items)))

    def test_provenance_adapter_and_provider_identity(self) -> None:
        item = self.rss.items[0]
        self.assertEqual(item.provenance.adapter_id, RSS_ADAPTER_ID)
        self.assertEqual(item.provenance.provider_item_id, self.rss.external_items[0].provider_item_id)
        self.assertEqual(item.provenance.source_instance_id, self.rss.source.instance_id)
        self.assertTrue(item.provenance.normalized)

    def test_raw_xml_is_not_in_provenance(self) -> None:
        representation = repr(self.rss.items[0].provenance).casefold()
        self.assertNotIn("<rss", representation)
        self.assertNotIn("<item", representation)
        self.assertNotIn("steal-cookie", representation)

    def test_unknown_provider_fields_are_ignored_not_metadata(self) -> None:
        self.assertTrue(all(item.metadata is None for item in (*self.rss.items, *self.atom.items)))
        self.assertEqual(set(self.rss.external_items[0].provider_fields), {"feed_format", "identity_basis"})
        self.assertNotIn("rating", self.rss.external_items[0].provider_fields)


class ExistingPipelineCompatibilityTests(TestCase):
    def setUp(self) -> None:
        self.ingestion = _rss_result()
        self.entries = _recommendation_entries(self.ingestion)

    def test_duplicate_feed_items_enter_existing_dedup(self) -> None:
        decision = compare(self.ingestion.items[0], self.ingestion.items[3])
        self.assertEqual(decision.kind, DuplicateKind.EXACT_DUPLICATE)

    def test_adapter_reuses_existing_canonical_identity(self) -> None:
        left = canonical_identity(self.ingestion.items[0].target_ref)
        right = canonical_identity(self.ingestion.items[3].target_ref)
        self.assertEqual(left, right)

    def test_rss_output_enters_existing_recommendation_orchestrator(self) -> None:
        result = RecommendationOrchestrator().recommend(self.entries, RecommendationContext(target_count=3))
        self.assertEqual(len(result.selections), 3)
        self.assertTrue(all(selection.entry.item.source.kind.value == "RSS" for selection in result.selections))
        self.assertEqual(result.unique_candidate_count, 3)

    def test_recommended_rss_items_enter_existing_audit_builder(self) -> None:
        recommendation = RecommendationOrchestrator().recommend(self.entries, RecommendationContext(target_count=3))
        snapshot = RecommendationAuditBuilder().build(
            recommendation,
            snapshot_id="audit-rss-smoke-v0.1",
            created_at=DISCOVERED,
        )
        self.assertEqual(len(snapshot.final_selections), 3)
        self.assertTrue(all(selection.source.kind == "RSS" for selection in snapshot.final_selections))
        self.assertTrue(RecommendationAuditReader().read_json(snapshot.to_json()).is_valid)

    def test_audit_does_not_leak_xml_html_or_provider_fields(self) -> None:
        recommendation = RecommendationOrchestrator().recommend(self.entries, RecommendationContext(target_count=3))
        snapshot = RecommendationAuditBuilder().build(
            recommendation,
            snapshot_id="audit-rss-safety-v0.1",
            created_at=DISCOVERED,
        )
        encoded = snapshot.to_json().casefold()
        for forbidden in ("<rss", "<item", "<script", "steal-cookie", "provider_fields", '"metadata"', "vendor:rating"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, encoded)

    def test_home_and_audit_contracts_need_no_provider_specific_fields(self) -> None:
        self.assertNotIn("provider_fields", {field.name for field in fields(type(self.entries[0].item))})


class OfflineDependencyBoundaryTests(TestCase):
    def test_full_adapter_chain_performs_no_network_calls(self) -> None:
        with mock.patch("socket.create_connection", side_effect=AssertionError("network call attempted")):
            with mock.patch("urllib.request.urlopen", side_effect=AssertionError("network call attempted")):
                ingestion = _rss_result()
                recommendation = RecommendationOrchestrator().recommend(
                    _recommendation_entries(ingestion), RecommendationContext(target_count=3)
                )
        self.assertEqual(len(recommendation.selections), 3)

    def test_rss_module_has_no_third_party_imports_or_network_client(self) -> None:
        import nexa_radar.rss_adapter as module

        source = Path(module.__file__).read_text(encoding="utf-8")
        tree = ast.parse(source)
        roots = {
            node.names[0].name.split(".")[0]
            for node in tree.body
            if isinstance(node, ast.Import)
        } | {
            (node.module or "").split(".")[0]
            for node in tree.body
            if isinstance(node, ast.ImportFrom) and node.level == 0
        }
        self.assertTrue(roots.issubset({"__future__", "dataclasses", "datetime", "email", "enum", "hashlib", "html", "re", "urllib", "xml"}))
        self.assertNotIn("urlopen", source)
        self.assertNotIn("requests", source)
        self.assertNotIn("aiohttp", source)


if __name__ == "__main__":
    import unittest

    unittest.main()
