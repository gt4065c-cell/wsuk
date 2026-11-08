#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
유튜브 영상 정보 읽기 도구 (YouTube Data API v3, 읽기 전용)

하는 일 (쉬운 말):
  - search  : 낱말로 영상 찾기 (제목·채널·올린 날짜)
  - videos  : 영상 번호(ID)로 조회수·좋아요·댓글 수·길이 보기
  - channel : 채널 번호(ID)로 구독자 수·영상 수 보기

열쇠: 환경변수 YOUTUBE_API_KEY (캡틴이 클라우드 환경 설정의 비밀 칸에 직접 넣음 — 채팅·저장소에 쓰지 않음)
비용: 무료 한도(하루 10,000점) 안. search 1번 = 100점, videos/channel 1번 = 1점.
     → search는 하루 약 100번까지. 한도를 넘으면 그날은 멈출 뿐 돈이 나가지 않음.
쓰기·업로드·댓글 달기 기능은 일부러 없음 (읽기 전용 키).

예)
  python3 02_리서치팀/tools/youtube_api.py search "AI 에이전트 강의" --max 10
  python3 02_리서치팀/tools/youtube_api.py videos dQw4w9WgXcQ abc123xyz00
  python3 02_리서치팀/tools/youtube_api.py channel UC_x5XG1OV2P6uZZ5FSM9Ttw
결과는 표(JSON)로 화면에 나옵니다. --json 을 붙이면 원본 그대로.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://www.googleapis.com/youtube/v3/"


def call(path, **params):
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not key:
        sys.exit("YOUTUBE_API_KEY 가 없습니다. 클라우드 환경 설정에 넣은 뒤 새 세션에서 다시 실행하세요.")
    params["key"] = key
    url = API + path + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:300]
        sys.exit(f"유튜브가 거절했어요 (HTTP {e.code}): {body}")
    except urllib.error.URLError as e:
        sys.exit(f"유튜브에 닿지 못했어요: {e.reason} — 환경의 허용 주소에 www.googleapis.com 이 있는지 확인")


def search(q, n):
    j = call("search", part="snippet", q=q, type="video", maxResults=min(max(n, 1), 50), regionCode="KR", relevanceLanguage="ko")
    return [{"id": it["id"]["videoId"], "title": it["snippet"]["title"], "channel": it["snippet"]["channelTitle"],
             "published": it["snippet"]["publishedAt"][:10]} for it in j.get("items", [])]


def videos(ids):
    j = call("videos", part="snippet,statistics,contentDetails", id=",".join(ids[:50]))
    out = []
    for it in j.get("items", []):
        s = it.get("statistics", {})
        out.append({"id": it["id"], "title": it["snippet"]["title"], "channel": it["snippet"]["channelTitle"],
                    "published": it["snippet"]["publishedAt"][:10], "duration": it["contentDetails"]["duration"],
                    "views": int(s.get("viewCount", 0)), "likes": int(s.get("likeCount", 0)) if "likeCount" in s else None,
                    "comments": int(s.get("commentCount", 0)) if "commentCount" in s else None})
    return out


def channel(ids):
    j = call("channels", part="snippet,statistics", id=",".join(ids[:50]))
    return [{"id": it["id"], "title": it["snippet"]["title"],
             "subscribers": int(it["statistics"].get("subscriberCount", 0)) if not it["statistics"].get("hiddenSubscriberCount") else None,
             "videos": int(it["statistics"].get("videoCount", 0)), "views": int(it["statistics"].get("viewCount", 0))}
            for it in j.get("items", [])]


def main():
    ap = argparse.ArgumentParser(description="유튜브 영상 정보 읽기 (읽기 전용)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search"); s.add_argument("q"); s.add_argument("--max", type=int, default=10)
    v = sub.add_parser("videos"); v.add_argument("ids", nargs="+")
    c = sub.add_parser("channel"); c.add_argument("ids", nargs="+")
    a = ap.parse_args()
    res = search(a.q, a.max) if a.cmd == "search" else videos(a.ids) if a.cmd == "videos" else channel(a.ids)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
