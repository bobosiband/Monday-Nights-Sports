/*
 * Unit tests for DrawGeneratorHandler. Covers the four code paths the SAM
 * template exposes: happy POST, validation 400, wrong method 405, and
 * unexpected failure 500 (without a stack trace in the body).
 */
package com.mondaynightsports.drawgenerator;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mondaynightsports.drawgenerator.domain.DrawStrategy;
import com.mondaynightsports.drawgenerator.domain.RoundRobinDrawStrategy;
import com.mondaynightsports.drawgenerator.domain.WrapAroundSlotAssigner;
import com.mondaynightsports.drawgenerator.validation.DrawRequestValidator;
import org.junit.jupiter.api.Test;

final class DrawGeneratorHandlerTest {

  private final ObjectMapper mapper = new ObjectMapper();
  private final DrawGeneratorHandler handler =
      new DrawGeneratorHandler(
          mapper,
          new RoundRobinDrawStrategy(),
          new WrapAroundSlotAssigner(),
          new DrawRequestValidator());

  @Test
  void happyPostReturnsFixtures() throws Exception {
    String body =
        "{\"teamIds\":[\"A\",\"B\",\"C\",\"D\"]," + "\"slotIds\":[\"S1\",\"S2\",\"S3\",\"S4\"]}";
    APIGatewayV2HTTPEvent event = postEvent(body);

    APIGatewayV2HTTPResponse response = handler.handleRequest(event, null);

    assertEquals(200, response.getStatusCode());
    JsonNode payload = mapper.readTree(response.getBody());
    JsonNode fixtures = payload.get("fixtures");
    assertNotNull(fixtures);
    // 4 teams -> 3 rounds, 2 fixtures per round -> 6 fixtures.
    assertEquals(6, fixtures.size());
    // The first fixture lands in slot S1 and corresponds to round 1.
    assertEquals(1, fixtures.get(0).get("round").asInt());
    assertEquals("S1", fixtures.get(0).get("slotId").asText());
  }

  @Test
  void validationErrorReturns400() throws Exception {
    APIGatewayV2HTTPEvent event = postEvent("{\"teamIds\":[\"A\"],\"slotIds\":[\"S1\"]}");

    APIGatewayV2HTTPResponse response = handler.handleRequest(event, null);

    assertEquals(400, response.getStatusCode());
    JsonNode payload = mapper.readTree(response.getBody());
    assertEquals("teamIds must be an array of at least 2 ids", payload.get("error").asText());
  }

  @Test
  void malformedJsonBodyReturns400() throws Exception {
    APIGatewayV2HTTPEvent event = postEvent("{\"teamIds\":[");

    APIGatewayV2HTTPResponse response = handler.handleRequest(event, null);

    assertEquals(400, response.getStatusCode());
    JsonNode payload = mapper.readTree(response.getBody());
    assertEquals("Request body must be JSON", payload.get("error").asText());
  }

  @Test
  void missingBodyReturns400() throws Exception {
    APIGatewayV2HTTPEvent event = postEvent(null);

    APIGatewayV2HTTPResponse response = handler.handleRequest(event, null);

    assertEquals(400, response.getStatusCode());
  }

  @Test
  void wrongMethodReturns405() throws Exception {
    APIGatewayV2HTTPEvent event = eventWithMethod("GET", null);

    APIGatewayV2HTTPResponse response = handler.handleRequest(event, null);

    assertEquals(405, response.getStatusCode());
    JsonNode payload = mapper.readTree(response.getBody());
    assertEquals("Method not allowed", payload.get("error").asText());
  }

  @Test
  void duplicateSlotIdsReturns400() throws Exception {
    String body = "{\"teamIds\":[\"A\",\"B\"],\"slotIds\":[\"S1\",\"S1\"]}";
    APIGatewayV2HTTPEvent event = postEvent(body);

    APIGatewayV2HTTPResponse response = handler.handleRequest(event, null);

    assertEquals(400, response.getStatusCode());
  }

  @Test
  void unexpectedFailureReturns500WithoutLeakingStack() throws Exception {
    DrawStrategy bomb =
        teamIds -> {
          throw new RuntimeException("boom");
        };
    DrawGeneratorHandler brokenHandler =
        new DrawGeneratorHandler(
            mapper, bomb, new WrapAroundSlotAssigner(), new DrawRequestValidator());

    APIGatewayV2HTTPEvent event = postEvent("{\"teamIds\":[\"A\",\"B\"],\"slotIds\":[\"S1\"]}");

    APIGatewayV2HTTPResponse response = brokenHandler.handleRequest(event, null);

    assertEquals(500, response.getStatusCode());
    JsonNode payload = mapper.readTree(response.getBody());
    assertEquals("Internal server error", payload.get("error").asText());
    // No stack trace, no "boom" leakage.
    assertFalse(response.getBody().contains("boom"));
    assertFalse(response.getBody().contains("Exception"));
  }

  @Test
  void jsonContentTypeHeaderIsSet() throws Exception {
    APIGatewayV2HTTPEvent event = postEvent("{\"teamIds\":[\"A\",\"B\"],\"slotIds\":[\"S1\"]}");
    APIGatewayV2HTTPResponse response = handler.handleRequest(event, null);
    assertTrue(response.getHeaders().getOrDefault("Content-Type", "").contains("application/json"));
  }

  private APIGatewayV2HTTPEvent postEvent(String body) {
    return eventWithMethod("POST", body);
  }

  private APIGatewayV2HTTPEvent eventWithMethod(String method, String body) {
    APIGatewayV2HTTPEvent.RequestContext.Http http =
        APIGatewayV2HTTPEvent.RequestContext.Http.builder().withMethod(method).build();
    APIGatewayV2HTTPEvent.RequestContext ctx =
        APIGatewayV2HTTPEvent.RequestContext.builder().withHttp(http).build();
    return APIGatewayV2HTTPEvent.builder()
        .withRequestContext(ctx)
        .withBody(body)
        .withIsBase64Encoded(false)
        .build();
  }
}
