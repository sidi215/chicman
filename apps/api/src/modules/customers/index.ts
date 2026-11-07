export {
  BOOTSTRAP_RATE_LIMIT,
  PROFILE_UPDATE_RATE_LIMIT,
  createCustomerRouter,
  type CustomerDependencies,
} from "./customer.routes.js";
export {
  PrismaCustomerRepository,
  type BootstrapResult,
  type CustomerAccount,
  type CustomerRepository,
  type RepositoryFaults,
} from "./customer.repository.js";
