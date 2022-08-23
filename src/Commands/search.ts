import type { CommandArgs } from ".";
import type { CommandMessage } from "../Component/CommandMessage";
import type { SelectMenuOptions } from "eris";
import type * as ytsr from "ytsr";

import { Helper } from "@mtripg6666tdr/eris-command-resolver";

import { BaseCommand } from ".";
import { searchYouTube } from "../AudioSource";
import { Util } from "../Util";
import { getColor } from "../Util/color";

export default class Search extends BaseCommand {
  constructor(){
    super({
      name: "検索",
      alias: ["search", "se"],
      description: "曲をYouTubeで検索します。直接URLを直接指定することもできます。",
      unlist: false,
      category: "playlist",
      examples: "検索 夜に駆ける",
      usage: "検索 <キーワード>",
      argument: [{
        type: "string",
        name: "keyword",
        description: "検索したい動画のキーワードまたはURL。",
        required: true
      }],
    });
  }

  async run(message:CommandMessage, options:CommandArgs){
    options.updateBoundChannel(message);
    options.JoinVoiceChannel(message);
    if(options.rawArgs.startsWith("http://") || options.rawArgs.startsWith("https://")){
      options.args.forEach(async u => {
        await options.PlayFromURL(message, u, !options.data[message.guild.id].Player.isConnecting);
      });
      return;
    }
    const s = Util.time.timer.start("Search(Command)->BeforeYtsr");
    if(options.data[message.guild.id].SearchPanel !== null){
      message.reply("✘既に開かれている検索窓があります").catch(e => Util.logger.log(e, "error"));
      return;
    }
    if(options.rawArgs !== ""){
      options.data[message.guild.id].SearchPanel = {} as any;
      const msg = await message.reply("🔍検索中...");
      options.data[message.guild.id].SearchPanel = {
        Msg: {
          id: msg.id,
          chId: msg.channel.id,
          userId: message.member.id,
          userName: Util.eris.user.getDisplayName(message.member),
          commandMessage: message
        },
        Opts: {}
      };
      s.end();
      try{
        const t = Util.time.timer.start("Search(Command)->Ytsr");
        const result = await searchYouTube(options.rawArgs);
        t.end();
        const u = Util.time.timer.start("Search(Command)->AfterYtsr");
        let desc = "";
        let index = 1;
        const selectOpts = [] as SelectMenuOptions[];
        for(let i = 0; i < result.items.length; i++){
          if(result.items[i].type === "video"){
            const video = (result.items[i] as ytsr.Video);
            desc += `\`${index}.\` [${video.title}](${video.url}) \`${video.duration}\` - \`${video.author.name}\` \r\n\r\n`;
            options.data[message.guild.id].SearchPanel.Opts[index] = {
              url: video.url,
              title: video.title,
              duration: video.duration,
              thumbnail: video.bestThumbnail.url
            };
            selectOpts.push({
              label: index + ". " + (video.title.length > 90 ? video.title.substring(0, 90) + "…" : video.title),
              description: `長さ: ${video.duration}, チャンネル名: ${video.author.name}`,
              value: index.toString()
            });
            index++;
          }
        }
        if(index === 1){
          options.data[message.guild.id].SearchPanel = null;
          await msg.edit(":pensive:見つかりませんでした。");
          return;
        }
        const embed = new Helper.MessageEmbedBuilder()
          .setTitle("\"" + options.rawArgs + "\"の検索結果✨")
          .setColor(getColor("SEARCH"))
          .setDescription(desc)
          .setFooter({
            icon_url: message.member.avatarURL,
            text: "動画のタイトルを選択して数字を送信してください。キャンセルするにはキャンセルまたはcancelと入力します。"
          })
          .toEris()
        ;
        await msg.edit({
          content: "",
          embeds: [embed],
          components: [
            new Helper.MessageActionRowBuilder()
              .addComponents(
                new Helper.MessageSelectMenuBuilder()
                  .setCustomId("search")
                  .setPlaceholder("数字を送信するか、ここから選択...")
                  .setMinValues(1)
                  .setMaxValues(index - 1)
                  .addOptions(...selectOpts, {
                    label: "キャンセル",
                    value: "cancel"
                  })
              )
              .toEris()
          ]
        });
        u.end();
      }
      catch(e){
        Util.logger.log(e, "error");
        options.data[message.guild.id].SearchPanel = null;
        if(msg) msg.edit("✘内部エラーが発生しました").catch(er => Util.logger.log(er, "error"));
        else message.reply("✘内部エラーが発生しました").catch(er => Util.logger.log(er, "error"));
      }
    }else{
      await message.reply("引数を指定してください").catch(e => Util.logger.log(e, "error"));
    }
  }
}
