// Authorization: the one module every location feature goes through (DESIGN §3).

export type { AuthCtx, Role } from "@trespass/shared/authz/ctx";
export {
  APP_ACTIONS,
  type AppAction,
  can,
  type ExportScope,
  exportScope,
  requireCan,
} from "./actions";
export { visibleLatExpr, visibleLonExpr } from "./coords";
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
  canAttachPhotoToLocation,
  canAttachPhotoToVisit,
  canDeletePhoto,
  canEditPhoto,
  canSeePhotoGps,
  canSeePhotoOriginal,
  canSetCoverPhoto,
  canUploadPhoto,
  type PhotosTableLike,
  photoLocationVisibleWhere,
  photosAtLeastWhere,
  photoVisitVisibleWhere,
  visiblePhotoIdsWhere,
  visiblePhotosWhere,
} from "./photos";
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
export {
  canCreateVisit,
  canMutateVisit,
  visibleVisitLocationWhere,
  visibleVisitsWhere,
  visitLocation,
} from "./visits";
