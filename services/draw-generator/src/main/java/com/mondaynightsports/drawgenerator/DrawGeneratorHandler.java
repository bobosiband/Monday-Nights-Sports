/*
 * Lambda entry point for the draw-generator service.
 *
 * Accepts an APIGatewayV2HTTPEvent so the same handler covers both the HTTP
 * API integration and a Lambda function URL. See services/draw-generator/
 * template.yaml for the SAM wiring (not deployed by any script here).
 *
 * The handler is a thin HTTP skin around the pure domain: validate, build
 * pairings via DrawStrategy, spread them via SlotAssigner, serialise. All
 * three pieces are injectable so tests can plug in fakes.
 */
package com.mondaynightsports.drawgenerator;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayV2HTTPResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mondaynightsports.drawgenerator.api.ErrorResponse;
import com.mondaynightsports.drawgenerator.api.GenerateDrawRequest;
import com.mondaynightsports.drawgenerator.api.GenerateDrawResponse;
import com.mondaynightsports.drawgenerator.api.ProposedFixture;
import com.mondaynightsports.drawgenerator.domain.DrawStrategy;
import com.mondaynightsports.drawgenerator.domain.Pairing;
import com.mondaynightsports.drawgenerator.domain.RoundRobinDrawStrategy;
import com.mondaynightsports.drawgenerator.domain.SlotAssigner;
import com.mondaynightsports.drawgenerator.domain.WrapAroundSlotAssigner;
import com.mondaynightsports.drawgenerator.validation.DrawRequestValidator;
import java.util.Map;

/** AWS Lambda handler for the draw-generator service. */
public final class DrawGeneratorHandler
    implements RequestHandler<APIGatewayV2HTTPEvent, APIGatewayV2HTTPResponse> {

  private static final Map<String, String> JSON_HEADERS =
      Map.of("Content-Type", "application/json; charset=utf-8");

  private final ObjectMapper mapper;
  private final DrawStrategy strategy;
  private final SlotAssigner assigner;
  private final DrawRequestValidator validator;

  /** Default constructor used by Lambda. Wires the production implementations. */
  public DrawGeneratorHandler() {
    this(
        new ObjectMapper(),
        new RoundRobinDrawStrategy(),
        new WrapAroundSlotAssigner(),
        new DrawRequestValidator());
  }

  /**
   * Full constructor for tests.
   *
   * @param mapper Jackson mapper.
   * @param strategy Draw strategy.
   * @param assigner Slot assigner.
   * @param validator Request validator.
   */
  public DrawGeneratorHandler(
      ObjectMapper mapper,
      DrawStrategy strategy,
      SlotAssigner assigner,
      DrawRequestValidator validator) {
    this.mapper = mapper;
    this.strategy = strategy;
    this.assigner = assigner;
    this.validator = validator;
  }

  /**
   * Handle one request.
   *
   * @param event The API Gateway v2 HTTP event (works for function URLs too).
   * @param context Lambda context; may be null in tests.
   * @return The response: 200 on success, 400 on validation, 405 on method, 500 on unexpected
   *     failures. The 500 does not leak a stack trace to the client.
   */
  @Override
  public APIGatewayV2HTTPResponse handleRequest(APIGatewayV2HTTPEvent event, Context context) {
    try {
      String method = httpMethod(event);
      if (method == null || !method.equalsIgnoreCase("POST")) {
        return error(405, "Method not allowed");
      }

      GenerateDrawRequest request = parseBody(event);
      // parseBody returns null when the body is missing or unparseable.
      if (request == null) {
        return error(400, "Request body must be JSON");
      }

      DrawRequestValidator.ValidationResult result = validator.validate(request);
      if (!result.ok()) {
        return error(400, result.error());
      }

      java.util.List<Pairing> pairings = strategy.buildDraw(request.teamIds());
      java.util.List<ProposedFixture> fixtures = assigner.assign(pairings, request.slotIds());

      return success(new GenerateDrawResponse(fixtures));
    } catch (IllegalArgumentException ex) {
      // The assigner raises these for duplicate slot ids etc. Treat as a
      // client error.
      return error(400, ex.getMessage());
    } catch (Exception ex) {
      if (context != null) {
        context.getLogger().log("draw-generator error: " + ex);
      }
      return error(500, "Internal server error");
    }
  }

  /**
   * Pull the HTTP method off the event. API Gateway v2 populates requestContext.http.method;
   * function URLs populate the same field.
   *
   * @param event The event.
   * @return Uppercase method or null.
   */
  private static String httpMethod(APIGatewayV2HTTPEvent event) {
    if (event == null) {
      return null;
    }
    APIGatewayV2HTTPEvent.RequestContext rc = event.getRequestContext();
    if (rc != null && rc.getHttp() != null && rc.getHttp().getMethod() != null) {
      return rc.getHttp().getMethod();
    }
    return null;
  }

  /**
   * Parse the JSON body into a request record, honouring base64 encoding when API Gateway flags it.
   *
   * @param event The event.
   * @return The parsed request, or null when the body is missing or unparseable.
   */
  private GenerateDrawRequest parseBody(APIGatewayV2HTTPEvent event) {
    String body = event.getBody();
    if (body == null || body.isEmpty()) {
      return null;
    }
    if (Boolean.TRUE.equals(event.getIsBase64Encoded())) {
      body = new String(java.util.Base64.getDecoder().decode(body));
    }
    try {
      return mapper.readValue(body, GenerateDrawRequest.class);
    } catch (JsonProcessingException ex) {
      return null;
    }
  }

  /**
   * Build a success response.
   *
   * @param body Response body.
   * @return The 200 response.
   */
  private APIGatewayV2HTTPResponse success(GenerateDrawResponse body) {
    try {
      return APIGatewayV2HTTPResponse.builder()
          .withStatusCode(200)
          .withHeaders(JSON_HEADERS)
          .withBody(mapper.writeValueAsString(body))
          .build();
    } catch (JsonProcessingException ex) {
      return error(500, "Internal server error");
    }
  }

  /**
   * Build an error response.
   *
   * @param status HTTP status code.
   * @param message Human-readable error.
   * @return The response.
   */
  private APIGatewayV2HTTPResponse error(int status, String message) {
    String body;
    try {
      body = mapper.writeValueAsString(new ErrorResponse(message));
    } catch (JsonProcessingException ex) {
      // Fallback to a hand-rolled envelope so error paths never 500 on
      // their own.
      body = "{\"error\":\"Internal server error\"}";
    }
    return APIGatewayV2HTTPResponse.builder()
        .withStatusCode(status)
        .withHeaders(JSON_HEADERS)
        .withBody(body)
        .build();
  }
}
