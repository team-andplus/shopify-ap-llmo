-- CreateTable (SQLite). ローカル開発用。
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" INTEGER NOT NULL DEFAULT 0,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" INTEGER,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" INTEGER NOT NULL DEFAULT 0,
    "locale" TEXT,
    "collaborator" INTEGER,
    "emailVerified" INTEGER,
    "refreshToken" TEXT,
    "refreshTokenExpires" DATETIME
);
