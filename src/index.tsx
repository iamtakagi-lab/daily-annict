// 環境変数、未設定なら例外処理
if (!process.env.ANNICT_CLIENT_ID || process.env.ANNICT_CLIENT_ID.length <= 0)
  throw new Error("ANNICT_CLIENT_ID が設定されていません");
if (
  !process.env.ANNICT_CLIENT_SECRET ||
  process.env.ANNICT_CLIENT_SECRET.length <= 0
)
  throw new Error("ANNICT_CLIENT_SECRET が設定されていません");
if (
  !process.env.ANNICT_REDIRECT_URI ||
  process.env.ANNICT_REDIRECT_URI.length <= 0
)
  throw new Error("ANNICT_REDIRECT_URI が設定されていません");

// 念のため、タイムゾーン設定
process.env.TZ = "Asia/Tokyo";

import moment from "moment";
import "moment/locale/ja";
import Koa from "koa";
import Router from "@koa/router";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import got from "got";
import $ from "transform-ts";
import fs from "fs";

/**
 * チャンネル情報
 */
interface Channel {
  id: number;
  name: string;
}

/**
 * 作品情報
 */
interface Facebook {
  og_image_url: string;
}

interface Twitter {
  mini_avatar_url: string;
  normal_avatar_url: string;
  bigger_avatar_url: string;
  original_avatar_url: string;
  image_url: string;
}

interface Images {
  recommended_url: string;
  facebook: Facebook;
  twitter: Twitter;
}

interface Work {
  id: number;
  title: string;
  title_kana: string;
  media: string;
  media_text: string;
  season_name: string;
  season_name_text: string;
  released_on: string;
  released_on_about: string;
  official_site_url: string;
  wikipedia_url: string;
  twitter_username: string;
  twitter_hashtag: string;
  syobocal_tid: string;
  mal_anime_id: string;
  images: Images;
  episodes_count: number;
  watchers_count: number;
}

/**
 * エピソード情報
 */
interface Episode {
  id: number;
  number: string;
  number_text: string;
  sort_number: number;
  title: string;
  records_count: number;
  record_comments_count: number;
}

/**
 * 放送予定情報
 */
interface Program {
  id: number;
  started_at: string;
  is_rebroadcast: boolean;
  channel: Channel;
  work: Work;
  episode: Episode;
}

interface Me {
  id: number;
  username: string;
  name: string;
  description: string;
  url: string;
  avatar_url: string;
  background_image_url: string;
  records_count: number;
  followings_count: number;
  followers_count: number;
  wanna_watch_count: number;
  watching_count: number;
  watched_count: number;
  on_hold_count: number;
  stop_watching_count: number;
  created_at: Date;
  email: string;
  notifications_count: number;
}

// Annict Endpoint
const annictApiEndpoint = "https://api.annict.com/v1" as const;

const annictOauthApiEndpoint = "https://api.annict.com/oauth" as const;

// Annict Client ID
const annictClientId = process.env.ANNICT_CLIENT_ID;

// Annict Client Secret
const annictClientSecret = process.env.ANNICT_CLIENT_SECRET;

// Annict Redirect URI
const annictRedirectUri = process.env.ANNICT_REDIRECT_URI;

/**
 * 放送予定情報 レスポンス
 */
interface ProgramsResponseObject {
  programs: Program[];
  total_count: number;
  next_page: number | null;
  prev_page: number | null;
}

/**
 * 指定された日付がその日かを返します
 * @param someDate
 * @returns boolean
 */
const isAtDate = (date: Date, targetDate: Date) => {
  return (
    date.getDate() == targetDate.getDate() &&
    date.getMonth() == targetDate.getMonth() &&
    date.getFullYear() == targetDate.getFullYear()
  );
};

/**
 * その日以降の放送予定を取得します
 * @returns
 */
const getPrograms = async (token: string, date: Date) => {
  const target = new URL(`${annictApiEndpoint}/me/programs`);
  target.searchParams.set("filter_unwatched", "false"); //視聴済みのアニメも取得
  target.searchParams.set("sort_started_at", "desc");
  target.searchParams.set(
    "filter_started_at_lt",
    moment(date).format("YYYY-MM-DD")
  );
  target.searchParams.set("per_page", "50");

  return await got<ProgramsResponseObject | null>(target.href, {
    responseType: "json",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).json<ProgramsResponseObject | null>();
};

const getMe = async (token: string) => {
  const target = new URL(`${annictApiEndpoint}/me`);
  return await got<ProgramsResponseObject | null>(target.href, {
    responseType: "json",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).json<Me | null>();
};

const app = new Koa();
const router = new Router();

/**
 * 静的assetsのルーティング
 */
try {
  const STATIC_DIR = __dirname + "/../static";
  const allowedFiles = fs.readdirSync(STATIC_DIR);

  if (allowedFiles.length)
    router.get("/static/:filename", async (ctx, next) => {
      const filename = $.string.transformOrThrow(ctx.params.filename);
      if (!allowedFiles.includes(filename)) return next();
      const ext = filename.split(".");
      ctx.type =
        (
          {
            js: "application/javascript",
            css: "text/css",
          } as { [key: string]: string }
        )[ext.slice(-1)[0]] ?? "application/octet-stream";
      ctx.body = fs.createReadStream(STATIC_DIR + "/" + filename);
    });
} catch (e) { }

/**
 * Annict 認可リクエスト URL
 */
const annictOAuthUrl = new URL(`${annictOauthApiEndpoint}/authorize`);
annictOAuthUrl.searchParams.set("client_id", annictClientId);
annictOAuthUrl.searchParams.set("response_type", "code");
annictOAuthUrl.searchParams.set("redirect_uri", annictRedirectUri);
annictOAuthUrl.searchParams.set("scope", "read");

type AnnictToken = {
  access_token: string;
  token_type: string;
  scope: string;
  created_at: number;
};

/**
 * Annict アクセストークンを取得します
 * @param code 認可後に取得した認証コード
 */
const getAnnictToken = async (code: string) => {
  const target = new URL(`${annictOauthApiEndpoint}/token`);
  return await got
    .post<AnnictToken | null>(target.href, {
      responseType: "json",
      json: {
        client_id: annictClientId,
        client_secret: annictClientSecret,
        grant_type: "authorization_code",
        redirect_uri: annictRedirectUri,
        code: code,
      },
    })
    .json<AnnictToken | null>();
};

const Top: React.FC<{}> = ({}) => (
    <div id="top">
      <h1>daily-annict</h1>
      <span>
        Annict
        で「見てる」「見たい」を選択しているアニメの放送予定時間を日別に表示するカレンダー
      </span>
      <span>
        GitHub: <a href="https://github.com/iamtakagi/daily-annict">https://github.com/iamtakagi/daily-annict</a>
      </span>
    </div>
)

const day = 24 * 60 * 60 * 1000;
const year = day * 365;

/**
 * ログイン以外はインデックスで全て処理する
 */
router.get("/", async (ctx, next) => {
  // 認可コードがクエリに付与されていたら
  const code = ctx.query["code"];
  if (code && typeof code === "string") {
    const annictToken = await getAnnictToken(code);
    if (!annictToken) return await next();
    ctx.cookies.set("annict_token", annictToken.access_token, {
      path: "/",
      httpOnly: false,
      maxAge: year,
      expires: new Date(Date.now() + year),
    });
    return ctx.redirect("/" + moment().format("YYYY/MM/DD"));
  }

  //アクセストークンがクッキーに付与されていたら
  const token = ctx.cookies.get("annict_token");
  if (token && typeof token === "string") {
    return ctx.redirect("/" + moment().format("YYYY/MM/DD"));
  }

  ctx.body = renderToStaticMarkup(
    <html lang="ja">
      <head>
        <meta charSet="UTF-8" />
        <link rel="stylesheet" href="/static/style.css" />
        <title>daily-annict</title>
        <meta name="twitter:card" content="summary" />
        <meta property="og:title" content="daily-annict" />
        <meta
          property="og:description"
          content="Annict で「見てる」「見たい」を選択しているアニメの放送予定時間を日別に表示するカレンダー"
        />
      </head>
      <body>
        <main>
          <Top/>
          <a href="/login">Annict でログイン</a>
        </main>
      </body>
    </html>
  );
});

/**
 * 日別ページ
 */
router.get("/:year/:month/:day", async (ctx, next) => {
  const { year, month, day } = ctx.params;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const path = `/${moment(date).format("YYYY/MM/DD")}`;
  if (path !== ctx.path) {
    return ctx.redirect(path);
  }
  const dateFormat = moment(date).format("YYYY/MM/DD (dddd)");
  const yesterday = moment(date).add(-1, "days").format("YYYY/MM/DD");
  const yesterdayD = moment(date).add(-1, "days").format("YYYY/MM/DD (ddd)");
  const tomorrow = moment(date).add(1, "days").format("YYYY/MM/DD");
  const tomorrowD = moment(date).add(1, "days").format("YYYY/MM/DD (ddd)");
  const token = ctx.cookies.get("annict_token");
  if (token && typeof token == "string") {
    const programsRes = await getPrograms(token, date);
    const me = await getMe(token);
    if (!programsRes || !me) return await next();
    const programs = programsRes.programs;
    // 今日放送予定の番組
    const dailyPrograms = programs
      .filter(
        (program) =>
          program.episode &&
          program.started_at &&
          isAtDate(new Date(program.started_at), date)
        // 時刻順に並べ替える
      )
      .sort((a, b) =>
        new Date(a.started_at).getTime() > new Date(b.started_at).getTime()
          ? 1
          : -1
      );
    ctx.body = renderToStaticMarkup(
      <html lang="ja">
        <head>
          <meta charSet="UTF-8" />
          <link rel="stylesheet" href="/static/style.css" />
          <script src="/static/script.js" defer />
          <title>daily-annict</title>
          <meta name="twitter:card" content="summary" />
          <meta property="og:title" content="daily-annict" />
          <meta
            property="og:description"
            content="Annict で「見てる」「見たい」を選択しているアニメの放送予定時間を日別に表示するカレンダー"
          />
        </head>
        <body>
          <div id="app">
            <a href={`/${yesterday}`} id="prev" className="prevnext">
              <span>
                <span className="link">前の日: {yesterdayD}</span>
                <br />
                <kbd>A</kbd>
              </span>
            </a>
            <main>
              <Top/>
              <section id="me">
                <img
                  id="avatar"
                  src={me.avatar_url}
                  alt=""
                  width={50}
                  height={50}
                />
                <div className="items">
                  <a href={`https://annict.com/@${me.username}`}>
                    {me.name} (@{me.username})
                  </a>
                  <a href="/logout">ログアウト</a>
                </div>
              </section>
              <section className="border">
                <h2>{dateFormat}</h2>
                {!dailyPrograms.length && <p>この日の放送予定はありません</p>}
                <div id="programs">
                  {dailyPrograms &&
                    dailyPrograms.map(
                      ({ work, episode, channel, started_at }, i) => {
                        return (
                          <div id="program" key={i}>
                            <img
                              src={work.images.recommended_url}
                              alt=""
                              height={`auto`}
                              width={`31%`}
                            />
                            <div className="items">
                              <a href={`https://annict.com/works/${work.id}`}>
                                {work.title}
                              </a>
                              {episode && (
                                <a
                                  href={`https://annict.com/works/${work.id}/episodes/${episode.id}`}
                                >
                                  {episode.number_text} {episode.title}
                                </a>
                              )}
                              <p>放送開始時期: {work.season_name_text}</p>
                              <p>{channel.name}</p>
                              <p>
                                {moment(new Date(started_at)).format(
                                  "YYYY/MM/DD HH:mm"
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      }
                    )}
                </div>
              </section>
            </main>
            <a href={`/${tomorrow}`} id="next" className="prevnext">
              <span>
                <span className="link">次の日: {tomorrowD}</span>
                <br />
                <kbd>D</kbd>
              </span>
            </a>
          </div>
        </body>
      </html>
    );
  }
});

/**
 * ログイン
 */
router.get("/login", async (ctx, next) => {
  ctx.redirect(annictOAuthUrl.href);
});

/**
 * ログアウト
 */
router.get("/logout", async (ctx, next) => {
  ctx.cookies.set("annict_token", null);
  ctx.redirect("/");
});

app.use(router.routes());
app.listen(process.env.PORT || 3000);