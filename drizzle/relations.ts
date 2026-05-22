import { relations } from "drizzle-orm/relations";
import { loginUsers, loginSessions, roles, rolePermissions, permissions, users, sessions, userPermissions, userRoles } from "./schema";

export const loginSessionsRelations = relations(loginSessions, ({one}) => ({
	loginUser: one(loginUsers, {
		fields: [loginSessions.userId],
		references: [loginUsers.id]
	}),
}));

export const loginUsersRelations = relations(loginUsers, ({many}) => ({
	loginSessions: many(loginSessions),
	userPermissions: many(userPermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({one}) => ({
	role: one(roles, {
		fields: [rolePermissions.roleId],
		references: [roles.id]
	}),
	permission: one(permissions, {
		fields: [rolePermissions.permissionId],
		references: [permissions.id]
	}),
}));

export const rolesRelations = relations(roles, ({many}) => ({
	rolePermissions: many(rolePermissions),
	userRoles: many(userRoles),
}));

export const permissionsRelations = relations(permissions, ({many}) => ({
	rolePermissions: many(rolePermissions),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	sessions: many(sessions),
	userRoles: many(userRoles),
}));

export const userPermissionsRelations = relations(userPermissions, ({one}) => ({
	loginUser: one(loginUsers, {
		fields: [userPermissions.userId],
		references: [loginUsers.id]
	}),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	user: one(users, {
		fields: [userRoles.userId],
		references: [users.id]
	}),
	role: one(roles, {
		fields: [userRoles.roleId],
		references: [roles.id]
	}),
}));