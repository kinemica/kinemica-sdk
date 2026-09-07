import { KinemicaValidationError } from "./errors.js";
import { parseResponse } from "./response.js";
import type { KinemicaHttpClient } from "./client.js";
import type { RequestOptions, Work } from "./types.js";
import { parseWorkResponse, validateIdentifier } from "./validation.js";

export class WorkResource {
  constructor(private readonly client: KinemicaHttpClient) {}

  async retrieve(workId: string, options?: RequestOptions): Promise<Work> {
    try {
      validateIdentifier(workId, "workId");
    } catch {
      throw new KinemicaValidationError("workId is invalid.");
    }
    const response = await this.client.request({
      method: "GET",
      path: `/work/${encodeURIComponent(workId)}`,
      ...(options ? { options } : {}),
    });
    return parseResponse(
      response,
      parseWorkResponse,
      "Kinemica returned an incompatible work response.",
    );
  }
}
