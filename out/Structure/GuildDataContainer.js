"use strict";
/*
 * Copyright 2021-2024 mtripg6666tdr
 *
 * This file is part of mtripg6666tdr/Discord-SimpleMusicBot.
 * (npm package name: 'discord-music-bot' / repository url: <https://github.com/mtripg6666tdr/Discord-SimpleMusicBot> )
 *
 * mtripg6666tdr/Discord-SimpleMusicBot is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later version.
 *
 * mtripg6666tdr/Discord-SimpleMusicBot is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with mtripg6666tdr/Discord-SimpleMusicBot.
 * If not, see <https://www.gnu.org/licenses/>.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GuildDataContainer = void 0;
const tslib_1 = require("tslib");
const voice_1 = require("@discordjs/voice");
const async_lock_1 = require("@mtripg6666tdr/async-lock");
const helper_1 = require("@mtripg6666tdr/oceanic-command-resolver/helper");
const soundcloud_ts_1 = tslib_1.__importDefault(require("soundcloud.ts"));
const LogEmitter_1 = require("./LogEmitter");
const AudioSource_1 = require("../AudioSource");
const AudioSource_2 = require("../AudioSource");
const playlist_1 = require("../AudioSource/youtube/playlist");
const Commands_1 = require("../Commands");
const audioEffectManager_1 = require("../Component/audioEffectManager");
const playManager_1 = require("../Component/playManager");
const preferencesManager_1 = require("../Component/preferencesManager");
const queueManager_1 = require("../Component/queueManager");
const searchPanelManager_1 = require("../Component/searchPanelManager");
const skipSession_1 = require("../Component/skipSession");
const taskCancellationManager_1 = require("../Component/taskCancellationManager");
const Util = tslib_1.__importStar(require("../Util"));
const config_1 = require("../config");
const definition_1 = require("../definition");
const i18n_1 = require("../i18n");
const logger_1 = require("../logger");
const YmxFormat_1 = require("../types/YmxFormat");
const config = (0, config_1.getConfig)();
/**
 * サーバーごとデータを保存するコンテナ
 */
class GuildDataContainer extends LogEmitter_1.LogEmitter {
    get cancellations() {
        return this._cancellations;
    }
    /** キューマネジャ */
    get queue() {
        return this._queue;
    }
    /** 再生マネジャ */
    get player() {
        return this._player;
    }
    /** 検索パネルマネジャ */
    get searchPanel() {
        return this._searchPanel;
    }
    /** オーディオエフェクトマネジャ */
    get audioEffects() {
        return this._audioEffects;
    }
    /** スキップセッション */
    get skipSession() {
        return this._skipSession;
    }
    /** 設定 */
    get preferences() {
        return this._preferences;
    }
    /** 紐づけテキストチャンネルを取得します */
    get boundTextChannel() {
        return this._boundTextChannel;
    }
    /** 紐づけテキストチャンネルを設定します */
    set boundTextChannel(val) {
        this._boundTextChannel = val;
    }
    get locale() {
        const guild = this.bot.client.guilds.get(this.getGuildId());
        // try to get the locale from the roles assigned to the bot, if present.
        const localeRegex = /\[locale:(?<locale>[a-z]{0,2}(-[A-Z]{0,2})?)\]$/;
        const localeRole = guild.clientMember.roles.map(roleId => guild.roles.get(roleId).name).find(role => localeRegex.test(role));
        if (localeRole && i18n_1.discordLanguages.includes(localeRole.match(localeRegex).groups.locale)) {
            return localeRole.match(localeRegex).groups.locale;
        }
        // try to get the default locale from the guild settings, if its community feature enabled.
        if (guild.features.includes("COMMUNITY") && guild.preferredLocale && i18n_1.discordLanguages.includes(guild.preferredLocale)) {
            return guild.preferredLocale;
        }
        return config.defaultLanguage;
    }
    constructor(guildId, boundchannelid, bot) {
        super("GuildDataContainer", guildId);
        this._cancellations = [];
        this._skipSession = null;
        this.joinVoiceChannelLocker = new async_lock_1.LockObj();
        if (!guildId) {
            throw new Error("invalid guild id was given");
        }
        this.boundTextChannel = boundchannelid;
        if (!this.boundTextChannel) {
            throw new Error("Invalid bound textchannel id was given");
        }
        this.bot = bot;
        this.prefix = ">";
        this.connection = null;
        this.initPlayManager();
        this.initQueueManager();
        this.initSearchPanelManager();
        this.initAudioEffects();
        this.initPreferences();
    }
    // 子クラスでオーバーライドされる可能性があるので必要
    initPlayManager() {
        this._player = new playManager_1.PlayManager(this);
    }
    // 同上
    initQueueManager() {
        this._queue = new queueManager_1.QueueManager(this);
    }
    // 同上
    initSearchPanelManager() {
        this._searchPanel = new searchPanelManager_1.SearchPanelManager(this);
    }
    // 同上
    initAudioEffects() {
        this._audioEffects = new audioEffectManager_1.AudioEffectManager(this);
    }
    initPreferences() {
        this._preferences = new preferencesManager_1.GuildPreferencesManager(this);
    }
    /**
     * 状況に応じてバインドチャンネルを更新します
     * @param message 更新元となるメッセージ
     */
    updateBoundChannel(message) {
        if (typeof message === "string") {
            this.boundTextChannel = message;
            return;
        }
        if (!this.player.isConnecting
            || (message.member.voiceState?.channelID
                && this.bot.client.getChannel(message.member.voiceState.channelID)
                    .voiceMembers.has(this.bot.client.user.id))
            || message.content.includes("join")) {
            if (message.content !== this.prefix)
                this.boundTextChannel = message.channelId;
        }
    }
    /**
     * キューをエクスポートしてYMX形式で出力します
     * @returns YMX化されたキュー
     */
    exportQueue() {
        return {
            version: YmxFormat_1.YmxVersion,
            data: this.queue
                .filter(item => !item.basicInfo.isPrivateSource)
                .map(q => ({
                ...q.basicInfo.exportData(),
                addBy: q.additionalInfo.addedBy,
            })),
        };
    }
    /**
     * YMXからキューをインポートします。
     * @param exportedQueue YMXデータ
     * @returns 成功したかどうか
     */
    async importQueue(exportedQueue) {
        if (exportedQueue.version === YmxFormat_1.YmxVersion) {
            const { data } = exportedQueue;
            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                await this.queue.addQueueOnly({
                    url: item.url,
                    addedBy: item.addBy,
                    gotData: item,
                });
            }
            return true;
        }
        return false;
    }
    /**
     * ステータスをエクスポートします
     * @returns ステータスのオブジェクト
     */
    exportStatus() {
        // VCのID:バインドチャンネルのID:ループ:キューループ:関連曲
        return {
            voiceChannelId: this.player.isPlaying && !this.player.isPaused ? this.connectingVoiceChannel.id : "0",
            boundChannelId: this.boundTextChannel,
            loopEnabled: this.queue.loopEnabled,
            queueLoopEnabled: this.queue.queueLoopEnabled,
            volume: this.player.volume,
            ...this.preferences.exportPreferences(),
        };
    }
    /**
     * ステータスをオブジェクトからインポートします。
     * @param param0 読み取り元のオブジェクト
     */
    importStatus(statuses) {
        //VCのID:バインドチャンネルのID:ループ:キューループ:関連曲
        this.queue.loopEnabled = !!statuses.loopEnabled;
        this.queue.queueLoopEnabled = !!statuses.queueLoopEnabled;
        this.preferences.importPreferences(statuses);
        this.player.setVolume(statuses.volume);
        if (statuses.voiceChannelId !== "0") {
            this.joinVoiceChannelOnly(statuses.voiceChannelId)
                .then(() => this.player.play())
                .catch(this.logger.error);
        }
    }
    /**
     * キャンセルマネージャーをサーバーと紐づけます
     * @param cancellation キャンセルマネージャー
     */
    bindCancellation(cancellation) {
        if (!this.cancellations.includes(cancellation)) {
            this._cancellations.push(cancellation);
        }
        return cancellation;
    }
    /**
     * キャンセルマネージャーにキャンセルを発行します
     * @returns キャンセルができたものがあればtrue
     */
    cancelAll() {
        const results = this.cancellations.map(c => c.cancel());
        return results.some(r => r);
    }
    /**
     * キャンセルマネージャーを破棄します
     * @param cancellation 破棄するキャンセルマネージャー
     * @returns 成功したかどうか
     */
    unbindCancellation(cancellation) {
        const index = this.cancellations.findIndex(c => c === cancellation);
        if (index < 0)
            return false;
        this._cancellations.splice(index, 1);
        return true;
    }
    /**
     * 指定されたボイスチャンネルに参加し、接続を保存し、適切なイベントハンドラを設定します。
     * @param channelId 接続先のボイスチャンネルのID
     * @internal
     */
    async joinVoiceChannelOnly(channelId) {
        const targetChannel = this.bot.client.getChannel(channelId);
        const connection = targetChannel.join({
            selfDeaf: true,
            debug: config.debug,
        });
        this.connectingVoiceChannel = targetChannel;
        if (this.connection === connection)
            return;
        await (0, voice_1.entersState)(connection, voice_1.VoiceConnectionStatus.Ready, 10e3);
        const connectionLogger = (0, logger_1.getLogger)("Connection", true);
        connectionLogger.addContext("id", this.getGuildId());
        connection.on("error", err => {
            connectionLogger.error(err);
        });
        this.connection = connection;
        if (config.debug) {
            connection.on("debug", connectionLogger.trace);
        }
        // ニックネームの変更
        const guild = this.bot.client.guilds.get(this.getGuildId());
        const botSelf = guild.clientMember;
        let nickname = botSelf.nick;
        // "⏹" これ
        const stopButton = String.fromCharCode(9209);
        if (nickname && (nickname.includes("🈳") || nickname.includes(stopButton) || nickname.includes("🈵") || nickname.includes("▶"))) {
            nickname = nickname.replace("🈳", "🈵");
            nickname = nickname.replace(stopButton, "▶");
            await guild.editCurrentMember({
                nick: nickname,
            }).catch(this.logger.error);
            // ニックネームを元に戻すやつ
            connection.once(voice_1.VoiceConnectionStatus.Destroyed, () => {
                nickname = nickname.replace("🈵", "🈳").replace("▶", stopButton);
                guild.editCurrentMember({
                    nick: nickname,
                }).catch(this.logger.error);
            });
        }
        this.logger.info(`Connected to ${channelId}`);
    }
    /**
     * ボイスチャンネルに接続します
     * @param message コマンドを表すメッセージ
     * @param reply 応答が必要な際に、コマンドに対して返信で応じるか新しいメッセージとして応答するか。
     * (trueで返信で応じ、falseで新規メッセージを作成します。デフォルトではfalse)
     * @returns 成功した場合はtrue、それ以外の場合にはfalse
     */
    async joinVoiceChannel(message, { reply = false, replyOnFail = false }) {
        return (0, async_lock_1.lock)(this.joinVoiceChannelLocker, async () => {
            const { t } = (0, Commands_1.getCommandExecutionContext)();
            if (message.member.voiceState?.channelID) {
                const targetVC = this.bot.client.getChannel(message.member.voiceState.channelID);
                if (targetVC.voiceMembers.has(this.bot.client.user.id)) {
                    // すでにそのにVC入ってるよ～
                    if (this.connection) {
                        return true;
                    }
                }
                else if (this.connection && !message.member.permissions.has("MOVE_MEMBERS")) {
                    // すでになにかしらのVCに参加している場合
                    const replyFailMessage = reply || replyOnFail
                        ? message.reply.bind(message)
                        : message.channel.createMessage.bind(message.channel);
                    await replyFailMessage({
                        content: `:warning:${t("guildDataContainer.alreadyJoined")}`,
                    }).catch(this.logger.error);
                    return false;
                }
                // 入ってないね～参加しよう
                const replyMessage = reply ? message.reply.bind(message) : message.channel.createMessage.bind(message.channel);
                const connectingMessage = await replyMessage({
                    content: `:electric_plug:${t("guildDataContainer.connecting")}...`,
                });
                try {
                    if (!targetVC.permissionsOf(this.bot.client.user.id).has("CONNECT")) {
                        throw new Error(t("guildDataContainer.unableToJoinPermission"));
                    }
                    await this.joinVoiceChannelOnly(targetVC.id);
                    await connectingMessage.edit({
                        content: `:+1:${t("guildDataContainer.connected", { channel: `:speaker:\`${targetVC.name}\`` })}`,
                    });
                    return true;
                }
                catch (e) {
                    this.logger.error(e);
                    const failedMsg = `😑${t("guildDataContainer.failedToConnect")}: ${typeof e === "object" && "message" in e ? `${e.message}` : e}`;
                    if (!reply && replyOnFail) {
                        await connectingMessage.delete()
                            .catch(this.logger.error);
                        await message.reply({
                            content: failedMsg,
                        })
                            .catch(this.logger.error);
                    }
                    else {
                        await connectingMessage?.edit({
                            content: failedMsg,
                        })
                            .catch(this.logger.error);
                    }
                    await this.player.disconnect().catch(this.logger.error);
                    return false;
                }
            }
            else {
                // あらメッセージの送信者さんはボイチャ入ってないん…
                const replyFailedMessage = reply || replyOnFail
                    ? message.reply.bind(message)
                    : message.channel.createMessage.bind(message.channel);
                await replyFailedMessage({
                    content: `${t("guildDataContainer.issuerNoVoiceChannel")}:relieved:`,
                }).catch(this.logger.error);
                return false;
            }
        });
    }
    /**
     * メッセージからストリームを判定してキューに追加し、状況に応じて再生を開始します
     * @param first キューの先頭に追加するかどうか
     */
    async playFromUrl(message, rawArg, { first = false, cancellable = false, privateSource = false, }) {
        const { t } = (0, Commands_1.getCommandExecutionContext)();
        if (Array.isArray(rawArg)) {
            const [firstUrl, ...restUrls] = rawArg
                .flatMap(fragment => Util.normalizeText(fragment).split(" "))
                .filter(url => url.startsWith("http"));
            const results = [];
            if (firstUrl) {
                results.push(...await this.playFromUrl(message, firstUrl, { first, cancellable: false }));
                if (restUrls) {
                    for (let i = 0; i < restUrls.length; i++) {
                        results.push(await this.queue.addQueue({
                            url: restUrls[i],
                            addedBy: message.member,
                            channel: message.channel,
                            privateSource,
                        }));
                    }
                }
            }
            return results.filter(d => d);
        }
        setTimeout(() => message.suppressEmbeds(true).catch(this.logger.error), 4000).unref();
        // Spotifyの短縮リンクを展開
        if (rawArg.match(/^https?:\/\/spotify.link\/[a-zA-Z\d]+$/)) {
            const result = await AudioSource_1.Spotify.expandShortenLink(rawArg);
            if (result) {
                rawArg = result.url;
            }
        }
        // 各種特殊ソースの解釈
        if (!config.isDisabledSource("custom")
            && rawArg.match(/^https?:\/\/(www\.|canary\.|ptb\.)?discord(app)?\.com\/channels\/[0-9]+\/[0-9]+\/[0-9]+$/)) {
            // Discordメッセへのリンクならば
            const smsg = await message.reply(`🔍${t("guildDataContainer.loadingMessage")}...`);
            try {
                // URLを分析してチャンネルIDとメッセージIDを抽出
                const ids = rawArg.split("/");
                const ch = this.bot.client.getChannel(ids[ids.length - 2]);
                if (!ch || !("getMessage" in ch) || typeof ch.getMessage !== "function") {
                    throw new Error(t("guildDataContainer.notTextChannel"));
                }
                const msg = await ch.getMessage(ids[ids.length - 1]);
                if (ch.guild.id !== msg.channel.guild.id) {
                    throw new Error(t("guildDataContainer.unableToPlayOtherServer"));
                }
                else if (msg.attachments.size <= 0 || Util.getResourceTypeFromUrl(msg.attachments.first()?.url || null) === "none") {
                    throw new Error(t("guildDataContainer.attachmentNotFound"));
                }
                const item = await this.queue.addQueue({
                    url: msg.attachments.first().url,
                    addedBy: message.member,
                    first,
                    cancellable,
                    message: smsg,
                    privateSource,
                });
                if (!item) {
                    return [];
                }
                await this.player.play({ bgm: false });
                return [item];
            }
            catch (e) {
                this.logger.error(e);
                await smsg.edit(`✘${t("components:queue.failedToAdd")}`)
                    .catch(this.logger.error);
                return [];
            }
        }
        // オーディオファイルへの直リンク？
        else if (!config.isDisabledSource("custom") && Util.getResourceTypeFromUrl(rawArg) !== "none") {
            const item = await this.queue.addQueue({
                url: rawArg,
                addedBy: message.member,
                sourceType: "custom",
                cancellable,
                first,
                message,
                privateSource,
            });
            if (!item) {
                return [];
            }
            await this.player.play({ bgm: false });
            return [item];
        }
        // youtubeのプレイリストへのリンク
        else if (!config.isDisabledSource("youtube")
            && !rawArg.includes("v=")
            && !rawArg.includes("/channel/")
            && playlist_1.Playlist.validateID(rawArg)) {
            const msg = await message.reply(`:hourglass_flowing_sand:${t("components:queue.processingPlaylistBefore")}`);
            const cancellation = this.bindCancellation(new taskCancellationManager_1.TaskCancellationManager());
            let items = null;
            try {
                const id = await playlist_1.Playlist.getPlaylistID(rawArg);
                const result = await (0, playlist_1.Playlist)(id, {
                    gl: "JP",
                    hl: "ja",
                    limit: 999 - this.queue.length,
                });
                items = await this.queue.processPlaylist(msg, cancellation, false, 
                /* known source */ "youtube", 
                /* result */ result.items, 
                /* playlist name */ result.title, 
                /* tracks count */ result.itemCount, 
                /* consumer */ (c) => ({
                    url: c.url,
                    channel: c.author,
                    description: t("components:queue.noDescriptionInPlaylist"),
                    isLive: c.isLive,
                    length: c.duration,
                    thumbnail: c.thumbnail,
                    title: c.title,
                }));
                if (cancellation.cancelled) {
                    await msg.edit(`✅${t("canceled")}`);
                }
                else {
                    const embed = new helper_1.MessageEmbedBuilder()
                        .setTitle(`✅${t("components:queue.processingPlaylistCompleted")}`)
                        // \`(${result.author.name})\` author has been null lately
                        .setDescription(`${result.visibility === "unlisted"
                        ? result.title
                        : `[${result.title}](${result.url})`}\r\n${t("components:queue.songsAdded", { count: items.length })}`)
                        .setThumbnail(result.thumbnailUrl || definition_1.DefaultAudioThumbnailURL)
                        .setColor(Util.color.getColor("PLAYLIST_COMPLETED"));
                    await msg.edit({
                        content: "",
                        embeds: [embed.toOceanic()],
                    });
                }
            }
            catch (e) {
                this.logger.error(e);
                await msg.edit(`✘${t("components:queue.failedToAdd")}`).catch(this.logger.error);
            }
            finally {
                this.unbindCancellation(cancellation);
            }
            await this.player.play({ bgm: false });
            return items;
        }
        // SoundCloudのプレイリスト
        else if (!config.isDisabledSource("soundcloud") && AudioSource_2.SoundCloudS.validatePlaylistUrl(rawArg)) {
            const msg = await message.reply(`:hourglass_flowing_sand:${t("components:queue.processingPlaylistBefore")}`);
            const sc = new soundcloud_ts_1.default();
            const playlist = await sc.playlists.getV2(rawArg);
            const cancellation = this.bindCancellation(new taskCancellationManager_1.TaskCancellationManager());
            let items = null;
            try {
                items = await this.queue.processPlaylist(msg, cancellation, false, "soundcloud", playlist.tracks, playlist.title, playlist.track_count, async (track) => {
                    const item = await sc.tracks.getV2(track.id);
                    return {
                        url: item.permalink_url,
                        title: item.title,
                        description: item.description,
                        length: Math.floor(item.duration / 1000),
                        author: item.user.username,
                        thumbnail: item.artwork_url,
                    };
                });
                if (cancellation.cancelled) {
                    await msg.edit(`✅${t("canceled")}`);
                }
                else {
                    const embed = new helper_1.MessageEmbedBuilder()
                        .setTitle(`✅${t("components:queue.processingPlaylistCompleted")}`)
                        .setDescription(`[${playlist.title}](${playlist.permalink_url}) \`(${playlist.user.username})\` \r\n`
                        + `${t("components:queue.songsAdded", { count: items.length })}`)
                        .setThumbnail(playlist.artwork_url)
                        .setColor(Util.color.getColor("PLAYLIST_COMPLETED"));
                    await msg.edit({ content: "", embeds: [embed.toOceanic()] });
                }
            }
            catch (e) {
                this.logger.error(e);
                await msg.edit(`✘${t("components:queue.failedToAdd")}`).catch(this.logger.error);
            }
            finally {
                this.unbindCancellation(cancellation);
            }
            await this.player.play({ bgm: false });
            return items;
        }
        // Spotifyのプレイリスト
        else if (!config.isDisabledSource("spotify") && AudioSource_1.Spotify.validatePlaylistUrl(rawArg) && AudioSource_1.Spotify.available) {
            const msg = await message.reply(`:hourglass_flowing_sand:${t("components:queue.processingPlaylistBefore")}`);
            const cancellation = this.bindCancellation(new taskCancellationManager_1.TaskCancellationManager());
            let items = null;
            try {
                const playlist = await AudioSource_1.Spotify.client.getData(rawArg);
                const tracks = playlist.trackList;
                items = await this.queue.processPlaylist(msg, cancellation, false, "spotify", tracks, playlist.name, tracks.length, async (track) => {
                    return {
                        url: AudioSource_1.Spotify.getTrackUrl(track.uri),
                        title: track.title,
                        artist: track.subtitle,
                        length: Math.floor(track.duration / 1000),
                    };
                });
                if (cancellation.cancelled) {
                    await msg.edit(`✅${t("canceled")}`);
                }
                else {
                    const embed = new helper_1.MessageEmbedBuilder()
                        .setTitle(`✅${t("components:queue.processingPlaylistCompleted")}`)
                        .setDescription(`[${playlist.title}](${AudioSource_1.Spotify.getPlaylistUrl(playlist.uri, playlist.type)}) \`(${playlist.subtitle})\` \r\n${t("components:queue.songsAdded", { count: items.length })}`)
                        .setThumbnail(playlist.coverArt.sources[0].url)
                        .setFields({
                        name: `:warning:${t("attention")}`,
                        value: t("components:queue.spotifyNotice"),
                    })
                        .setColor(Util.color.getColor("PLAYLIST_COMPLETED"));
                    await msg.edit({ content: "", embeds: [embed.toOceanic()] });
                }
            }
            catch (e) {
                this.logger.error(e);
                await msg.edit(`✘${t("components:queue.failedToAdd")}`)
                    .catch(this.logger.error);
            }
            finally {
                this.unbindCancellation(cancellation);
            }
            await this.player.play({ bgm: false });
            return items;
        }
        // その他の通常のURLを解釈
        else {
            try {
                const success = await this.queue.addQueue({
                    url: rawArg,
                    addedBy: message.member,
                    first,
                    message,
                    cancellable,
                    privateSource,
                });
                if (!success) {
                    return [];
                }
                await this.player.play({ bgm: false });
                return [success];
            }
            catch (er) {
                this.logger.error(er);
                // なに指定したし…
                await message.reply(`🔭${t("guildDataContainer.invalidUrl")}`)
                    .catch(this.logger.error);
                return [];
            }
        }
    }
    async playFromMessage(commandMessage, message, context, morePrefs) {
        const { t } = (0, Commands_1.getCommandExecutionContext)();
        const prefixLength = context.server.prefix.length;
        if (message.content.startsWith("http://") || message.content.startsWith("https://")) {
            // URLのみのメッセージか？
            await context.server.playFromUrl(commandMessage, message.content, morePrefs);
            return;
        }
        else if (message.content.substring(prefixLength).startsWith("http://")
            || message.content.substring(prefixLength).startsWith("https://")) {
            // プレフィックス+URLのメッセージか？
            await context.server.playFromUrl(commandMessage, message.content.substring(prefixLength), morePrefs);
            return;
        }
        else if (message.attachments.size > 0) {
            // 添付ファイル付きか？
            await context.server.playFromUrl(commandMessage, message.attachments.first().url, morePrefs);
            return;
        }
        else if (message.author.id === context.client.user.id || config.isWhiteListedBot(message.author.id)) {
            // ボットのメッセージなら
            // 埋め込みを取得
            const embed = message.embeds[0];
            if (embed.color === Util.color.getColor("SONG_ADDED")
                || embed.color === Util.color.getColor("AUTO_NP")
                || embed.color === Util.color.getColor("NP")) {
                // 曲関連のメッセージならそれをキューに追加
                const url = embed.description?.match(/^\[.+\]\((?<url>https?.+)\)/)?.groups.url;
                if (url) {
                    await context.server.playFromUrl(commandMessage, url, morePrefs);
                    return;
                }
            }
        }
        await commandMessage.reply(`:face_with_raised_eyebrow: ${t("commands:play.noContent")}`)
            .catch(this.logger.error);
    }
    /**
     * 検索パネルのオプション番号を表すインデックス番号から再生します
     * @param nums インデックス番号の配列
     * @param message
     */
    async playFromSearchPanelOptions(nums, panel) {
        const includingNums = panel.filterOnlyIncludes(nums.map(n => Number(n)).filter(n => !isNaN(n)));
        const { urls: items, responseMessage, } = panel.decideItems(includingNums);
        const [first, ...rest] = items;
        // いっこめをしょり
        await this.queue.addQueue({
            url: first,
            addedBy: panel.commandMessage.member,
            fromSearch: responseMessage,
            cancellable: this.queue.length >= 1,
        });
        // 現在の状態を確認してVCに接続中なら接続試行
        if (panel.commandMessage.member.voiceState?.channelID) {
            await this.joinVoiceChannel(panel.commandMessage, {});
        }
        // 接続中なら再生を開始
        if (this.player.isConnecting && !this.player.isPlaying) {
            await this.player.play({ bgm: false });
        }
        // 二個目以降を処理
        for (let i = 0; i < rest.length; i++) {
            await this.queue.addQueue({
                url: rest[i],
                addedBy: panel.commandMessage.member,
                channel: panel.commandMessage.channel,
            });
        }
    }
    /**
     * プレフィックス更新します
     * @param message 更新元となるメッセージ
     */
    updatePrefix(message) {
        const oldPrefix = this.prefix;
        const member = message.guild.members.get(this.bot.client.user.id);
        const pmatch = (member.nick || member.username).match(/^(\[(?<prefix0>[a-zA-Z!?_-]+)\]|【(?<prefix1>[a-zA-Z!?_-]+)】)/);
        if (pmatch) {
            if (this.prefix !== (pmatch.groups.prefix0 || pmatch.groups.prefix1)) {
                this.prefix = Util.normalizeText(pmatch.groups.prefix0 || pmatch.groups.prefix1);
            }
        }
        else if (this.prefix !== config.prefix) {
            this.prefix = config.prefix;
        }
        if (this.prefix !== oldPrefix) {
            this.logger.info(`Prefix was set to '${this.prefix}'`);
        }
    }
    /**
     * 指定されたコマンドメッセージをもとに、スキップ投票を作成します
     * @param message ベースとなるコマンドメッセージ
     */
    async createSkipSession(message) {
        this._skipSession = new skipSession_1.SkipSession(this);
        await this._skipSession.init(message);
        const destroy = () => {
            this._skipSession?.destroy();
            this._skipSession = null;
        };
        this.queue.once("change", destroy);
        this.player.once("disconnect", destroy);
    }
}
exports.GuildDataContainer = GuildDataContainer;
//# sourceMappingURL=GuildDataContainer.js.map