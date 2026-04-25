const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Create a document
const doc = new PDFDocument();

// Create the templates directory if it doesn't exist
const templatesDir = path.join(__dirname, 'templates');
if (!fs.existsSync(templatesDir)) {
  fs.mkdirSync(templatesDir, { recursive: true });
}

// Pipe its output somewhere, like to a file or HTTP response
const filePath = path.join(templatesDir, 'franchise_agreement_template.pdf');
doc.pipe(fs.createWriteStream(filePath));

// Embed a font, set the font size, and render some text
doc.fontSize(20).text('FRANCHISE AGREEMENT', 100, 80);

doc.fontSize(12).text('This Agreement is made and entered into on _________ day of ____________, 20__', 100, 140);

doc.fontSize(14).text('BETWEEN:', 100, 180);
doc.fontSize(12).text('_______________________________ (hereinafter referred to as the "Company")', 100, 200);

doc.moveDown();
doc.fontSize(14).text('AND:', 100, 240);
doc.fontSize(12).text('_______________________________ (hereinafter referred to as the "Franchisee")', 100, 260);

doc.moveDown();
doc.fontSize(16).text('RECITALS', 100, 300);
doc.fontSize(12).text('WHEREAS, the Company has developed a unique system for providing credit repair services;', 100, 330);
doc.text('WHEREAS, the Franchisee desires to obtain a license to operate a franchise using the Company\'s system;', 100, 350);
doc.text('NOW, THEREFORE, in consideration of the mutual covenants contained herein, the parties agree as follows:', 100, 390);

doc.moveDown();
doc.fontSize(16).text('AGREEMENT TERMS', 100, 430);
doc.fontSize(12).text('1. GRANT OF FRANCHISE', 100, 460);
doc.text('The Company grants to the Franchisee a non-exclusive license to operate a Credit Dost franchise.', 120, 480);

doc.moveDown();
doc.text('2. TERM', 100, 520);
doc.text('The term of this Agreement shall be ______ years, commencing on ____________.', 120, 540);

doc.moveDown();
doc.text('3. FEES', 100, 580);
doc.text('The Franchisee shall pay to the Company an initial franchise fee of Rs. _________.', 120, 600);

// Finalize PDF file
doc.end();

console.log(`PDF template created at: ${filePath}`);