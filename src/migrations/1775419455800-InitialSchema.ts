import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1775419455800 implements MigrationInterface {
    name = 'InitialSchema1775419455800'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "offers" ("id" SERIAL NOT NULL, "offeredPrice" double precision NOT NULL, "accepted" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "mechanicId" integer, "requestId" integer, CONSTRAINT "PK_4c88e956195bba85977da21b8f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."requests_status_enum" AS ENUM('pending', 'accepted', 'arrived', 'working', 'completed', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "requests" ("id" SERIAL NOT NULL, "problemType" character varying NOT NULL, "description" text, "areaName" character varying(255), "lat" double precision NOT NULL, "lng" double precision NOT NULL, "status" "public"."requests_status_enum" NOT NULL DEFAULT 'pending', "suggestedPrice" double precision, "finalPrice" double precision, "rating" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" integer, "helperId" integer, CONSTRAINT "PK_0428f484e96f9e6a55955f29b5f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('user', 'helper', 'admin')`);
        await queryRunner.query(`CREATE TYPE "public"."users_categories_enum" AS ENUM('flat_tire', 'fuel', 'battery', 'tow')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "name" character varying(100) NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "lat" double precision, "lng" double precision, "isOnline" boolean NOT NULL DEFAULT false, "isBusy" boolean NOT NULL DEFAULT false, "role" "public"."users_role_enum" NOT NULL DEFAULT 'user', "categories" "public"."users_categories_enum" array, "isVerified" boolean NOT NULL DEFAULT false, "cnicImage" text, "totalEarnings" double precision NOT NULL DEFAULT '0', "rating" double precision NOT NULL DEFAULT '0', "ratingCount" integer NOT NULL DEFAULT '0', "availableBalance" double precision NOT NULL DEFAULT '0', "pendingBalance" double precision NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "app_settings" ("id" SERIAL NOT NULL, "key" character varying NOT NULL, "value" character varying NOT NULL, CONSTRAINT "UQ_975c2db59c65c05fd9c6b63a2ab" UNIQUE ("key"), CONSTRAINT "PK_4800b266ba790931744b3e53a74" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" SERIAL NOT NULL, "txnRefNo" character varying NOT NULL, "amount" double precision NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "jazzcashTransactionId" character varying, "userId" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_71e4e45d6967b525954dffba833" UNIQUE ("txnRefNo"), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "offers" ADD CONSTRAINT "FK_f9616f06156ea675650eab77c46" FOREIGN KEY ("mechanicId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "offers" ADD CONSTRAINT "FK_fb79c9671239d9dae540eaa5131" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "requests" ADD CONSTRAINT "FK_be846ad4b43f40acc7034ef7f40" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "requests" ADD CONSTRAINT "FK_0539047d6cccc2b76685265480a" FOREIGN KEY ("helperId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_d35cb3c13a18e1ea1705b2817b1" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_d35cb3c13a18e1ea1705b2817b1"`);
        await queryRunner.query(`ALTER TABLE "requests" DROP CONSTRAINT "FK_0539047d6cccc2b76685265480a"`);
        await queryRunner.query(`ALTER TABLE "requests" DROP CONSTRAINT "FK_be846ad4b43f40acc7034ef7f40"`);
        await queryRunner.query(`ALTER TABLE "offers" DROP CONSTRAINT "FK_fb79c9671239d9dae540eaa5131"`);
        await queryRunner.query(`ALTER TABLE "offers" DROP CONSTRAINT "FK_f9616f06156ea675650eab77c46"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TABLE "app_settings"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_categories_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP TABLE "requests"`);
        await queryRunner.query(`DROP TYPE "public"."requests_status_enum"`);
        await queryRunner.query(`DROP TABLE "offers"`);
    }

}
