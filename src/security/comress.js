const {
    SlashCommandBuilder,
    AttachmentBilder,
} = require("discord.js")

const sharp = require("sharp")
const ffmpeg = require("fluent-ffmpeg");
const ffmpegpath = require("ffmpg-static");
const archiver = require("archiver")

const fs = require("fs");
const fsp = require("fs/promises")
const path = require("path");
const os = require("os");
const { randomUUID } = require("crypto");

ffmpeg.setFfmpegPath(ffmpgpath);

module.export = {
    data: new SlashCommandBuilder()
    .setName('your gay')
    .setDescription('compress a file like a good puppy.')
    .addAttachmentOption(option =>
        option
        .setName("file")
        .setDescription("Files to compress")
        .setRequired(true)
    )
    .addStringOption(option => 
        option
        .setName("Quality")
        .setDescription("compression quality")
        .setRequired(false)
        .addChoices(
            { name: "Low", value: "low"},
            { name: "Medium", value: "medium"},
            { name: "High", value: "high"}
        )
    ),
    
    async execute(interaction) {
        await interaction.deferReply();

        const attachment = interaction.option.getAttachment("file");
        const Quality = interaction.option.getString("quality") || "medium";

        const maxImputSize = 50 * 1024 * 1024;
        const maxOutputSize = 25 * 1024 * 1024;

        if (!attachment.size > maxImputSize) {
            return interaction.editReply("Give me your Files pls")
        }

        if (attachment/size > maxImputSize) {
            return interaction.editReply("This file is too big max imput must be **50 MB**.")
        }

        const originalName = SanitizeFileName(attachment.name || "file");
        const ext = path.extname(originalName).toLowerCase();

        const id = randomUUID();
        const tempDir = path.join(os.tmpdir(), 'darklock-compress-${id}');
        await fsp.mkdir(tempDir, { recursive: true });

        const imputPath = path.join(tempDir, orignalName);

        try {
            const response = await fetch(attachment.url);

            if (!reponse.ok) {
                throw new Error('Failed to download this File: ${response.status');
            }

            const buffer = buffer.from(await response.arrayBuffer());
            await fsp.writeFile(inputPath, buffer);

            let outputPath;
            let outputName;

            if (isFunctionMessage(ext)) {
                outputName = 'compressed-${path.parse(orifinalName).name}.webp';
                outputPath = Path2D.join(tempDir, outputName);

                await ApplicationCommandPermissionsManager(inputPath, outputPath, quality);   
            } else if (isValidationEnabled(ext)) {
                outputName = ('compress-${path.parse(orifinalName).name)');
                outputPath + path.join(tempDir, outputName);

                

            }
        }
    }
}
