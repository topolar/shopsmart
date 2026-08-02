import {
  ALBERT_CONNECTOR_MANIFEST,
  ALBERT_HYPERMARKET_SCOPE,
  ALBERT_SUPERMARKET_SCOPE,
  GLOBUS_CONNECTOR_MANIFEST,
  KAUFLAND_CONNECTOR_MANIFEST,
  type FileSystemRawSnapshotStore,
} from "@shopsmart/connectors";
import type {
  TypeOrmConnectorJobStore,
  TypeOrmSourceIngestionStore,
} from "@shopsmart/database";

import {
  reprocessStoredAlbertSnapshot,
  runAlbertOperationOnce,
} from "./albert-operation.js";
import type { ConnectorRuntimeAdapter } from "./connector-runtime.js";
import {
  reprocessStoredGlobusSnapshot,
  runGlobusOperationOnce,
} from "./globus-operation.js";
import {
  reprocessStoredKauflandSnapshot,
  runKauflandOperationOnce,
} from "./kaufland-operation.js";

type ConnectorId = "albert" | "globus" | "kaufland";

export function createConnectorAdapters(input: {
  jobs: TypeOrmConnectorJobStore;
  ingestion: TypeOrmSourceIngestionStore;
  rawSnapshotStore(connectorId: ConnectorId): FileSystemRawSnapshotStore;
}): readonly ConnectorRuntimeAdapter[] {
  return [
    {
      manifest: ALBERT_CONNECTOR_MANIFEST,
      run: ({ now, workerId }) =>
        runAlbertOperationOnce({
          now,
          workerId,
          jobs: input.jobs,
          ingestion: input.ingestion,
          rawSnapshots: input.rawSnapshotStore("albert"),
        }),
      reprocess: (sourceScopeKey) =>
        reprocessStoredAlbertSnapshot({
          kind:
            sourceScopeKey === ALBERT_SUPERMARKET_SCOPE.key
              ? "supermarket"
              : sourceScopeKey === ALBERT_HYPERMARKET_SCOPE.key
                ? "hypermarket"
                : failUnknownScope(),
          ingestion: input.ingestion,
          rawSnapshots: input.rawSnapshotStore("albert"),
        }),
    },
    {
      manifest: GLOBUS_CONNECTOR_MANIFEST,
      run: ({ now, workerId }) =>
        runGlobusOperationOnce({
          now,
          workerId,
          jobs: input.jobs,
          ingestion: input.ingestion,
          rawSnapshots: input.rawSnapshotStore("globus"),
        }),
      reprocess: (sourceScopeKey) => {
        assertScope(GLOBUS_CONNECTOR_MANIFEST, sourceScopeKey);
        return reprocessStoredGlobusSnapshot({
          ingestion: input.ingestion,
          rawSnapshots: input.rawSnapshotStore("globus"),
        });
      },
    },
    {
      manifest: KAUFLAND_CONNECTOR_MANIFEST,
      run: ({ now, workerId }) =>
        runKauflandOperationOnce({
          now,
          workerId,
          jobs: input.jobs,
          ingestion: input.ingestion,
          rawSnapshots: input.rawSnapshotStore("kaufland"),
        }),
      reprocess: (sourceScopeKey) => {
        assertScope(KAUFLAND_CONNECTOR_MANIFEST, sourceScopeKey);
        return reprocessStoredKauflandSnapshot({
          ingestion: input.ingestion,
          rawSnapshots: input.rawSnapshotStore("kaufland"),
        });
      },
    },
  ];
}

function assertScope(
  manifest:
    typeof GLOBUS_CONNECTOR_MANIFEST | typeof KAUFLAND_CONNECTOR_MANIFEST,
  sourceScopeKey: string,
) {
  if (!manifest.scopes.some(({ key }) => key === sourceScopeKey)) {
    failUnknownScope();
  }
}

function failUnknownScope(): never {
  throw new Error("UNKNOWN_CONNECTOR_SCOPE");
}
