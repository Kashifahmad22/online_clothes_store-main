import mongoose from "mongoose";

const connectDB = async () => {

    mongoose.connection.on('connected',() => {
        console.log("DB Connected");
    })

    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI must be configured.");
    }

    await mongoose.connect(process.env.MONGODB_URI, { dbName: "e-commerce" })

}

export default connectDB;