/*
 * Parity test: assert the Java round-robin + wrap-around spread produce
 * byte-for-byte the same output as the TypeScript side for a shared set of
 * JSON fixtures under src/test/resources/parity/. The Deno test at
 * tests/events/DrawParity.test.ts runs the same files through the
 * TypeScript generator. If the two sides diverge, both tests fail at
 * once and the fixture is the exact minimum reproducer.
 */
package com.mondaynightsports.drawgenerator.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mondaynightsports.drawgenerator.api.ProposedFixture;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

final class ParityFixturesTest {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final String[] FIXTURE_FILES = {
    "parity/four-teams-four-slots.json",
    "parity/three-teams-two-slots-with-byes.json",
    "parity/six-teams-three-slots-wrap.json",
    "parity/two-teams-one-slot.json",
    "parity/five-teams-four-slots.json",
  };

  private final RoundRobinDrawStrategy strategy = new RoundRobinDrawStrategy();
  private final WrapAroundSlotAssigner assigner = new WrapAroundSlotAssigner();

  /**
   * Load every fixture file for the parameterized test.
   *
   * @return A stream of fixture nodes.
   */
  static Stream<JsonNode> parityFixtures() throws Exception {
    List<JsonNode> out = new ArrayList<>();
    for (String path : FIXTURE_FILES) {
      try (InputStream in = ParityFixturesTest.class.getClassLoader().getResourceAsStream(path)) {
        assertNotNull(in, "missing parity fixture on classpath: " + path);
        out.add(MAPPER.readTree(in));
      }
    }
    return out.stream();
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("parityFixtures")
  void matchesTypeScriptOutput(JsonNode fixture) throws Exception {
    JsonNode input = fixture.get("input");
    List<String> teamIds = asStringList(input.get("teamIds"));
    List<String> slotIds = asStringList(input.get("slotIds"));

    List<Pairing> pairings = strategy.buildDraw(teamIds);
    List<ProposedFixture> actual = assigner.assign(pairings, slotIds);

    List<ProposedFixture> expected = new ArrayList<>();
    for (JsonNode row : fixture.get("expected")) {
      expected.add(
          new ProposedFixture(
              row.get("round").asInt(),
              row.get("slotId").asText(),
              row.get("homeTeamId").asText(),
              row.get("awayTeamId").isNull() ? null : row.get("awayTeamId").asText()));
    }

    assertEquals(expected, actual, "parity drift on fixture " + fixture.get("name").asText());
  }

  private static List<String> asStringList(JsonNode node) {
    List<String> out = new ArrayList<>(node.size());
    for (JsonNode entry : node) {
      out.add(entry.asText());
    }
    return out;
  }
}
