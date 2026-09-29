import { PRODUCT_NAME } from "../brand.js";
import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";

export class OpenClawAgentDatabaseMediaMigrationRequiredError extends StartupMaintenanceRequiredError {
  constructor(
    readonly pathname: string,
    readonly schemaVersion: number,
  ) {
    super(
      "agent-media",
      `${PRODUCT_NAME} agent database ${pathname} uses schema version ${schemaVersion}; run paddy doctor --fix to migrate persisted media before using it.`,
    );
    this.name = "OpenClawAgentDatabaseMediaMigrationRequiredError";
  }
}
