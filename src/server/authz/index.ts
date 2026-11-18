// Authorization: the one module every location feature goes through (DESIGN §3).
export {
  APP_ACTIONS,
  type AppAction,
  can,
  type ExportScope,
  exportScope,
  requireCan,
} from "./actions";
export { visibleLatExpr, visibleLonExpr } from "./coords";
export type { AuthCtx, Role } from "./ctx";
export {
  atLeast,
  canSeeExact,
  FRIENDS_LEVELS,
  type FriendsLevel,
  friendLevelsAtLeast,
  type GrantRef,
  grantLevel,
  grantLevelsAtLeast,
  isVisible,
  LEVELS,
  type Level,
  type LocationAuthFields,
  levelRank,
  locationLevel,
  maxLevel,
  minLevel,
  ROLE_CEILING,
  type VisibleLevel,
} from "./levels";
export {
  type LeveledLocation,
  loadLocationForCtx,
  locationLevels,
  requireLocationForCtx,
  withLevels,
} from "./load";
export {
  type LocationsTableLike,
  locationsAtLeastWhere,
  preciseWhere,
  visibleLocationsWhere,
} from "./predicates";
export {
  type SerializeExtra,
  serializeLeveled,
  serializeLocation,
  serializeLocationsForCtx,
} from "./serialize";
