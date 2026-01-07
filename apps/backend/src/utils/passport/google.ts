import { AuthProvider, prisma, Role } from "@repo/database/client";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { createID } from "../nanoID";


passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
      passReqToCallback: false
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;

        if (!email) {
          return done(new Error("Google did not return an email"), undefined);
        }

        let user = await prisma.user.findUnique({
          where: { email },
        });

        if (user) {
          // Logic to update provider info but verify status is NOT updated automatically
          await prisma.userProvider.upsert({
            where: {
              provider_providerUserId: {
                provider: AuthProvider.GOOGLE,
                providerUserId: profile.id
              }
            },
            update: {},
            create: {
              publicId: createID(),
              userId: user.id,
              provider: AuthProvider.GOOGLE,
              providerUserId: profile.id,
            }
          });

          return done(null, user);
        }
        const newUser = await prisma.user.create({
          data: {
            publicId: createID(),
            name: profile.displayName,
            email,
            authProvider: AuthProvider.GOOGLE,
            role: Role.CUSTOMER,
          },
        });

        await prisma.userProvider.create({
          data: {
            publicId: createID(),
            userId: newUser.id,
            provider: AuthProvider.GOOGLE,
            providerUserId: profile.id,
          },
        });

        return done(null, newUser);

      } catch (err) {
        console.error("Google Auth Error:", err);
        return done(err, false);
      }
    }
  )
);

export default passport;