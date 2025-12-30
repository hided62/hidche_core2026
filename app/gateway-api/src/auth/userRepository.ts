export interface UserRecord {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
    sanctions: UserSanctions;
    passwordHash: string;
    passwordSalt: string;
    createdAt: string;
}

export interface PublicUser {
    id: string;
    username: string;
    displayName: string;
    roles: string[];
    createdAt: string;
}

export interface UserSanctions {
    bannedUntil?: string;
    mutedUntil?: string;
    suspendedUntil?: string;
    warningCount?: number;
    flags?: string[];
    notes?: string;
}

export const toPublicUser = (user: UserRecord): PublicUser => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: user.roles,
    createdAt: user.createdAt,
});

export interface CreateUserInput {
    username: string;
    password: string;
    displayName?: string;
}

export interface UserRepository {
    findByUsername(username: string): Promise<UserRecord | null>;
    createUser(input: CreateUserInput): Promise<UserRecord>;
    verifyPassword(user: UserRecord, password: string): Promise<boolean>;
}
