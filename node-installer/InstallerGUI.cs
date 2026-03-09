using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

namespace NeuroStore.Installer
{
    public class SetupForm : Form
    {
        private TextBox txtStorageSize;
        private TextBox txtStoragePath;
        private Button btnBrowse;
        private Button btnInstall;
        private Label lblStatus;
        private ProgressBar prgInstall;

        private const string ServiceName = "NeurostoreNode";
        private const string EmbeddedNodeExe = "neuro-node.exe";

        public SetupForm()
        {
            this.Text = "NeuroStore Core Node Installer";
            this.Size = new Size(540, 400);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42); // Dark slate
            this.Font = new Font("Segoe UI", 10f, FontStyle.Regular);

            // Header Banner
            Panel pnlHeader = new Panel();
            pnlHeader.BackColor = Color.FromArgb(16, 185, 129); // Emerald
            pnlHeader.Size = new Size(540, 70);
            pnlHeader.Location = new Point(0, 0);

            Label lblHeader = new Label();
            lblHeader.Text = "Deploy Storage Node";
            lblHeader.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblHeader.ForeColor = Color.White;
            lblHeader.AutoSize = true;
            lblHeader.Location = new Point(20, 18);
            pnlHeader.Controls.Add(lblHeader);
            this.Controls.Add(pnlHeader);

            // Storage Size Label
            Label lblSize = new Label();
            lblSize.Text = "1. Rent Space (GB):";
            lblSize.ForeColor = Color.LightGray;
            lblSize.Location = new Point(30, 95);
            lblSize.AutoSize = true;
            this.Controls.Add(lblSize);

            txtStorageSize = new TextBox();
            txtStorageSize.Text = "50";
            txtStorageSize.Location = new Point(30, 125);
            txtStorageSize.Size = new Size(120, 25);
            txtStorageSize.BackColor = Color.FromArgb(30, 41, 59);
            txtStorageSize.ForeColor = Color.White;
            txtStorageSize.BorderStyle = BorderStyle.FixedSingle;
            this.Controls.Add(txtStorageSize);

            // Storage Path Label
            Label lblPath = new Label();
            lblPath.Text = "2. Base Directory for Vault:";
            lblPath.ForeColor = Color.LightGray;
            lblPath.Location = new Point(30, 175);
            lblPath.AutoSize = true;
            this.Controls.Add(lblPath);

            string defaultPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "NeuroStore");
            txtStoragePath = new TextBox();
            txtStoragePath.Text = defaultPath;
            txtStoragePath.Location = new Point(30, 205);
            txtStoragePath.Size = new Size(390, 25);
            txtStoragePath.BackColor = Color.FromArgb(30, 41, 59);
            txtStoragePath.ForeColor = Color.White;
            txtStoragePath.BorderStyle = BorderStyle.FixedSingle;
            this.Controls.Add(txtStoragePath);

            btnBrowse = new Button();
            btnBrowse.Text = "Browse";
            btnBrowse.Location = new Point(430, 203);
            btnBrowse.Size = new Size(70, 28);
            btnBrowse.BackColor = Color.FromArgb(51, 65, 85);
            btnBrowse.ForeColor = Color.White;
            btnBrowse.FlatStyle = FlatStyle.Flat;
            btnBrowse.FlatAppearance.BorderSize = 0;
            btnBrowse.Click += BtnBrowse_Click;
            btnBrowse.Cursor = Cursors.Hand;
            this.Controls.Add(btnBrowse);

            lblStatus = new Label();
            lblStatus.Text = "A locked encrypted vault will be created automatically.";
            lblStatus.ForeColor = Color.DarkGray;
            lblStatus.Location = new Point(30, 250);
            lblStatus.Size = new Size(490, 20);
            this.Controls.Add(lblStatus);

            prgInstall = new ProgressBar();
            prgInstall.Location = new Point(30, 280);
            prgInstall.Size = new Size(470, 10);
            prgInstall.Style = ProgressBarStyle.Continuous;
            this.Controls.Add(prgInstall);

            btnInstall = new Button();
            btnInstall.Text = "Initialize Node && Lock Vault";
            btnInstall.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            btnInstall.BackColor = Color.FromArgb(16, 185, 129);
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Location = new Point(140, 310);
            btnInstall.Size = new Size(260, 45);
            btnInstall.Click += BtnInstall_Click;
            btnInstall.Cursor = Cursors.Hand;
            this.Controls.Add(btnInstall);
        }

        private void BtnBrowse_Click(object sender, EventArgs e)
        {
            using (FolderBrowserDialog fbd = new FolderBrowserDialog())
            {
                fbd.Description = "Select a Base Directory for the NeuroStore Vault";
                fbd.SelectedPath = txtStoragePath.Text;
                if (fbd.ShowDialog() == DialogResult.OK)
                {
                    txtStoragePath.Text = fbd.SelectedPath;
                }
            }
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            int size;
            if (!int.TryParse(txtStorageSize.Text, out size) || size <= 0)
            {
                MessageBox.Show("Please enter a valid amount of rent space (GB).", "Input Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            if (string.IsNullOrWhiteSpace(txtStoragePath.Text))
            {
                MessageBox.Show("Please select a base directory.", "Input Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            btnInstall.Enabled = false;
            btnBrowse.Enabled = false;
            txtStoragePath.Enabled = false;
            txtStorageSize.Enabled = false;

            lblStatus.Text = "Extracting decentralized node payload...";
            lblStatus.ForeColor = Color.LightGray;
            prgInstall.Value = 20;

            try
            {
                string programData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NeuroStoreCore");
                Directory.CreateDirectory(programData);

                string exeDest = Path.Combine(programData, EmbeddedNodeExe);
                ExtractResource("NeuroStore.Installer.neuro-node.exe", exeDest);

                prgInstall.Value = 40;
                lblStatus.Text = "Generating unique cryptographic node identity...";
                
                Directory.CreateDirectory(txtStoragePath.Text);
                string tempVault = Path.Combine(txtStoragePath.Text, "NS_TEMP_" + Guid.NewGuid().ToString().Substring(0, 8));
                Directory.CreateDirectory(tempVault);

                string nodeId = GenerateNodeId(exeDest, tempVault);
                
                string finalPath = Path.Combine(txtStoragePath.Text, nodeId);
                if (Directory.Exists(finalPath)) 
                {
                    Directory.Delete(tempVault, true);
                    nodeId = GenerateNodeId(exeDest, finalPath);
                } 
                else 
                {
                    Directory.Move(tempVault, finalPath);
                }

                prgInstall.Value = 60;
                lblStatus.Text = "Locking the vault against unauthorized access...";

                File.SetAttributes(finalPath, File.GetAttributes(finalPath) | FileAttributes.Hidden | FileAttributes.System);
                RunCmd("cmd.exe", "/c icacls \"" + finalPath + "\" /inheritance:r /grant:r \"SYSTEM\":(OI)(CI)F /grant:r \"Administrators\":(OI)(CI)F");

                prgInstall.Value = 80;
                lblStatus.Text = "Registering Windows Background Service...";

                InstallService(exeDest, size, finalPath, nodeId);

                prgInstall.Value = 100;
                lblStatus.Text = "Installation successful!";
                lblStatus.ForeColor = Color.FromArgb(16, 185, 129);

                MessageBox.Show("Node ID: " + nodeId + " is now active.\nYour storage vault is secured and locked at:\n" + finalPath, "Setup Complete", MessageBoxButtons.OK, MessageBoxIcon.Information);

                Process.Start("https://neurostore-next.vercel.app/dashboard/node?node_id=" + nodeId);
                Application.Exit();
            }
            catch (Exception ex)
            {
                lblStatus.Text = "Installation failed!";
                lblStatus.ForeColor = Color.Red;
                MessageBox.Show("Error during installation: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
                btnBrowse.Enabled = true;
                txtStoragePath.Enabled = true;
                txtStorageSize.Enabled = true;
            }
        }

        private void ExtractResource(string resourceName, string outPath)
        {
            using (Stream resStream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (resStream == null) throw new Exception("Embedded neuro-node.exe resource not found!");
                using (FileStream fs = new FileStream(outPath, FileMode.Create, FileAccess.Write))
                {
                    resStream.CopyTo(fs);
                }
            }
        }

        private string GenerateNodeId(string exePath, string storagePath)
        {
            // Execute the daemon once just to get the peer ID
            ProcessStartInfo info = new ProcessStartInfo(exePath);
            info.Arguments = "--storage-path \"" + storagePath + "\" --print-peer-id";
            info.UseShellExecute = false;
            info.RedirectStandardOutput = true;
            info.CreateNoWindow = true;

            using (Process p = Process.Start(info))
            {
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                
                if (string.IsNullOrWhiteSpace(output))
                {
                    return "NEURO-UNKNOWN";
                }
                
                string peerId = output.Trim();
                if (peerId.Length >= 8)
                {
                    return "NEURO-" + peerId.Substring(0, 8).ToUpper();
                }
                return peerId;
            }
        }

        private void InstallService(string exePath, int maxGb, string storagePath, string nodeId)
        {
            // First stop/delete existing if any
            RunCmd("sc", "stop " + ServiceName);
            RunCmd("sc", "delete " + ServiceName);
            System.Threading.Thread.Sleep(500);

            // Create service
            string binPath = "\"" + exePath + "\" --run-as-service --storage-path \"" + storagePath + "\" --max-gb " + maxGb;
            RunCmd("sc", "create " + ServiceName + " binPath= \"" + binPath + "\" start= auto obj= LocalSystem");
            RunCmd("sc", "description " + ServiceName + " \"NeuroStore Decentralized Storage Network Zero-Knowledge Daemon. Provides disk capacity to the P2P swarm.\"");
            
            // Set failure recovery
            RunCmd("sc", "failure " + ServiceName + " reset= 30 actions= restart/5000/restart/10000/restart/60000");

            // Start it
            RunCmd("sc", "start " + ServiceName);
        }

        private void RunCmd(string file, string args)
        {
            ProcessStartInfo info = new ProcessStartInfo(file, args);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            using (Process p = Process.Start(info))
            {
                p.WaitForExit();
            }
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }
}
