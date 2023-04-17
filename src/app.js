import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv"
import joi from "joi";
import dayjs from "dayjs";
import { stripHtml } from "string-strip-html";

//Criação do APP Servidor
const app = express();

//Configurações do servidor
app.use(cors());
app.use(express.json());
dotenv.config();

//Conexão com o banco de dados
let db;
const mongoClient = new MongoClient(process.env.DATABASE_URL)
mongoClient
  .connect()
  .then(() => (db = mongoClient.db()))
  .catch((err) => console.log(err.message));

//Endpoints
function sanitizeString(value) {
    return stripHtml(value).result.trim();
  }

app.post("/participants", async (req, res) => {
    const { name } = req.body

    const participantSchema = joi.object({
        name: joi.string().required()
    })

    const validation = participantSchema.validate(req.body, { abortEarly: false })

    if (validation.error) {
        const errors = validation.error.details.map(detail => detail.message)
        return res.status(422).send(errors)
    }

    try {
        const participant = await db.collection("participants").findOne({ name: name })
        if (participant) return res.status(409).send("Esse nome já está em uso.")

        await db.collection("participants").insertOne({name: sanitizeString(name), lastStatus:Date.now()})

        const message = {from: sanitizeString(name),
            to: 'Todos',
            text: 'entra na sala...',
            type: 'status',
            time: dayjs().format("HH:mm:ss")
        }
        await db.collection("messages").insertOne(message)
        res.sendStatus(201)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.get("/participants", async (req, res) => {
    try {
        const participants = await db.collection("participants").find().toArray()
        res.send(participants)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.post("/messages", async (req, res) => {
    
    const { to, text, type } = req.body;
    const from = req.headers.user;

    if (!from || from === null) return res.sendStatus(422)

    const messageSchema = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid("message", "private_message").required()
    })

    const validation = messageSchema.validate(req.body, { abortEarly: false })
    if (validation.error) {
        const errors = validation.error.details.map(detail => detail.message)
        return res.status(422).send(errors)
    }

    try {
        const participant = await db.collection("participants").findOne({name : from})
        if (!participant) {
            return res.sendStatus(422)
        }
        const message = {from, to, text:sanitizeString(text), type, time: dayjs().format("HH:mm:ss")}
        await db.collection("messages").insertOne(message)
        res.sendStatus(201)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.get("/messages", async (req, res) => {
    const user = req.headers.user;
    const limit = Number(req.query.limit);

    if (isNaN(limit) || limit <= 0 ) {
        return res.sendStatus(422);
    }
    try {
        const messages = await db.collection("messages")
        .find({ $or: [ { to: "Todos"}, { to: user }, {from: user}, {type: "public"} ] } )
        .limit(limit)
        .toArray()
        res.send(messages)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.delete("/messages/:id", async (req, res) => {
    const { id } = req.params;
    const { to, text, type } = req.body;
    const user = req.headers.user;

    try {
        const message = await db.collection("messages").findOne({ _id: new ObjectId(id) })
        if (!message) return res.sendStatus(404)
        if (message.from != user) return res.sendStatus(401)

        await db.collection("messages").deleteOne({ _id: new ObjectId(id)  })
        res.send("Item deletado com sucesso!")

    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.put("/messages/:id", async (req, res) => {
    const { id } = req.params;
    const {to, text, type} = req.body
    const from = req.headers.user;

    if (!from || from === null) return res.sendStatus(422)

    const messageSchema = joi.object({
        to: joi.string().required(),
        text: joi.string().required(),
        type: joi.string().valid("message", "private_message").required()
    })

    const validation = messageSchema.validate(req.body, { abortEarly: false })
    if (validation.error) {
        const errors = validation.error.details.map(detail => detail.message)
        return res.status(422).send(errors)
    }

    try {
        const participant = await db.collection("participants").findOne({_id : new ObjectId(id)})
        if (!participant) return res.sendStatus(404)
        if (participant.name != from) return res.sendStatus(401)
        
        const result = await db.collection("messages").updateOne(
            { _id: new ObjectId(id) },
            { $set: req.body }
        )
        if (result.matchedCount === 0) return res.sendStatus(404);
        res.sendStatus(200)
    } catch (err) {
        res.status(500).send(err.message)
    }
})

app.post("/status", async (req, res) => {
    const user = req.headers.user;

    if (!user) return res.sendStatus(404)

    try {
        const participant = await db.collection("participants").findOne({name : user})
        if (!participant) {
            return res.sendStatus(404)
        }
        await db.collection("participants").updateOne(
            { _id: participant._id },
            { $set: {lastStatus : Date.now() }}
        )
        res.sendStatus(200)

    }catch(err){
        res.status(500).send(err.message);
    }
})

setInterval(async () => { 
    let inativeTime = Date.now() - 10000;
    try{
        const inativeParticipants = await db.collection("participants").find({ lastStatus: { $lte: inativeTime}}).toArray()

        if (!inativeParticipants || inativeParticipants === []) return res.sendStatus(200)

    inativeParticipants.map(async participant => {
        const message = { 
            from: participant.name,
            to: 'Todos',
            text: 'sai da sala...',
            type: 'status',
            time: dayjs().format("HH:mm:ss")
        }
        await db.collection("messages").insertOne(message)
        await db.collection("participants").deleteMany({ lastStatus: { $lte: inativeTime}})
    })
    }catch(err){
        res.status(500).send(err.message);
    }
}, 15000)
// Deixa o app escutando, à espera de requisições
const PORT = 5000
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`)) 