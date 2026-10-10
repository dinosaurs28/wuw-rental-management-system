import type { ComponentType, ReactNode } from "react";
import { ManagerLayout } from "@/components/manager/ManagerLayout";
import { EmployeeLayout } from "@/components/employee/EmployeeLayout";
import {
  employeeCustomersService,
  managerCustomersService,
  type CustomersService,
} from "@/services/managerCustomers.service";
import { employeeCustomerKey } from "@/services/employeeCustomer.service";

/**
 * What differs between the branch manager's and the Fleet Executive's
 * Customers pages. Records, actions and rules are the same (one backend
 * handler set); only the API prefix, routes and page chrome change.
 */
export interface CustomersPortal {
  service: CustomersService;
  /** Route prefix of the portal's Customers pages, e.g. "/manager/customers". */
  customersPath: string;
  dashboardPath: string;
  /** Portal part of the react-query keys (see customersTabKey). */
  queryKey: string;
  Layout: ComponentType<{ children: ReactNode }>;
  /** Credit ledger page (branch manager only — Fleet has none). */
  ledgerPath?: (customerPublicId: string) => string;
  /** Other cached views of the customer to refresh after a blacklist change. */
  relatedKeys?: (userPublicId: string) => readonly unknown[][];
}

/**
 * react-query key under one portal's Customers tab — distinct from every
 * other customer cache (e.g. the walk-in ["employee-customer", userPublicId]),
 * and [portal.queryKey, "customers-tab"] alone matches all of the tab's queries.
 */
export const customersTabKey = (portal: Pick<CustomersPortal, "queryKey">, ...parts: unknown[]) => [
  portal.queryKey,
  "customers-tab",
  ...parts,
];

export const MANAGER_CUSTOMERS_PORTAL: CustomersPortal = {
  service: managerCustomersService,
  customersPath: "/manager/customers",
  dashboardPath: "/manager/dashboard",
  queryKey: "manager",
  Layout: ManagerLayout,
  ledgerPath: (id) => `/manager/ledger/${id}`,
};

export const EMPLOYEE_CUSTOMERS_PORTAL: CustomersPortal = {
  service: employeeCustomersService,
  customersPath: "/employee/customers",
  dashboardPath: "/employee/dashboard",
  queryKey: "employee",
  Layout: EmployeeLayout,
  // The walk-in booking screens cache the customer (blacklist included) by User publicId.
  relatedKeys: (userPublicId) => [[...employeeCustomerKey(userPublicId)]],
};
