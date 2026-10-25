export { assessAffordability, DEFAULT_REFERENCE_VEHICLE_PRICE, type AssessmentOptions } from "@/lib/affordability/assessment";
export { buildAffordableSearchConstraints } from "@/lib/affordability/constraints";
export {
  calculateOwnershipCosts,
  DEFAULT_OWNERSHIP_COST_ASSUMPTIONS,
  ownershipInputForListing,
  type OwnershipCostAssumptions,
  type OwnershipCostInput,
} from "@/lib/affordability/ownership";
export { evaluateVehicle, type VehicleEvaluation } from "@/lib/affordability/vehicle";
